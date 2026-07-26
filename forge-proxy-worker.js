// ABION FORGE — CORS proxy + optional session sync (Cloudflare Worker)
//
// Two jobs in one Worker:
//
// 1. CORS proxy: NVIDIA's NIM endpoint (and some other OpenAI-compatible
//    APIs) don't send Access-Control-Allow-Origin, so a static-hosted
//    FORGE can't call them directly from the browser. This Worker sits
//    in between: browser -> this Worker -> upstream API -> back to
//    browser, streaming included, with CORS headers added on the way
//    back. It does NOT store or see your API key any differently than
//    talking to NVIDIA directly would — the key still comes from the
//    browser's request (Authorization header, set from FORGE's
//    Settings) and is forwarded as-is.
//
// 2. Session sync (optional): GET/PUT/DELETE /sessions/{key} reads and
//    writes a single JSON blob per key in Workers KV, so FORGE's chat
//    sessions can follow you across devices instead of being stuck in
//    one browser's localStorage. {key} is whatever "SYNC KEY" you set
//    in FORGE Settings — treat it like a passphrase, not a public ID.
//    Requires a KV namespace bound to this Worker as `SESSIONS` (see
//    wrangler.toml, or bind it in the dashboard under Settings ->
//    Variables and Bindings -> KV Namespace Bindings).

const ALLOWED_UPSTREAM_HOSTS = new Set([
  'integrate.api.nvidia.com',
  // Add other API hosts here if you switch providers, e.g.:
  // 'api.openai.com',
  // 'openrouter.ai',
]);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

const SESSION_KEY_RE = /^[A-Za-z0-9._-]{1,200}$/; // keep KV keys sane, no path traversal

async function handleSessions(request, env, origin, syncKey) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

  if (!SESSION_KEY_RE.test(syncKey)) {
    return new Response(JSON.stringify({ error: 'Invalid sync key' }), { status: 400, headers });
  }
  if (!env.SESSIONS) {
    return new Response(
      JSON.stringify({ error: 'No SESSIONS KV namespace bound to this Worker. Add one in Settings -> Variables and Bindings.' }),
      { status: 500, headers }
    );
  }

  const kvKey = 'sessions:' + syncKey;

  if (request.method === 'GET') {
    const stored = await env.SESSIONS.get(kvKey);
    if (stored === null) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    return new Response(stored, { status: 200, headers });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const body = await request.text();
    // Basic sanity check — must be valid JSON and under KV's 25MB value limit.
    try { JSON.parse(body); } catch (e) {
      return new Response(JSON.stringify({ error: 'Body must be valid JSON' }), { status: 400, headers });
    }
    if (body.length > 20 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Payload too large (20MB limit)' }), { status: 413, headers });
    }
    await env.SESSIONS.put(kvKey, body);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (request.method === 'DELETE') {
    await env.SESSIONS.delete(kvKey);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    // Session sync route: /sessions/{key}
    const sessionsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/?$/);
    if (sessionsMatch) {
      return handleSessions(request, env, origin, decodeURIComponent(sessionsMatch[1]));
    }

    // Expect: https://<worker>.workers.dev/<upstream-host>/<rest-of-path>
    // e.g. /integrate.api.nvidia.com/v1/chat/completions
    const parts = url.pathname.split('/').filter(Boolean);
    const upstreamHost = parts.shift();

    if (!upstreamHost || !ALLOWED_UPSTREAM_HOSTS.has(upstreamHost)) {
      return new Response(
        JSON.stringify({ error: 'Unknown or disallowed upstream host: ' + upstreamHost }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
      );
    }

    const upstreamUrl = 'https://' + upstreamHost + '/' + parts.join('/') + url.search;

    // Forward the request as-is (method, headers, body) to the upstream API.
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete('Origin');
    upstreamHeaders.delete('Referer');

    const upstreamRes = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    // Stream the response straight through (works for SSE/streaming chat
    // completions), just adding CORS headers.
    const responseHeaders = new Headers(upstreamRes.headers);
    const cors = corsHeaders(origin);
    for (const [k, v] of Object.entries(cors)) responseHeaders.set(k, v);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  },
};
