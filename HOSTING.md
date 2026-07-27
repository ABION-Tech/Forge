# Hosting ABION FORGE

FORGE now ships as a small set of static files (not just one HTML file
anymore, since PWA installability requires a real `manifest.json` and
service worker as separate files):

```
index.html
manifest.json
sw.js
icon-192.png
icon-512.png
apple-touch-icon.png
```

Keep all six in the same folder when you deploy — `index.html` references
the others by relative path. Everything (sessions, settings, API key)
still lives only in the visitor's own browser via `localStorage`, and the
app talks directly from their browser to whichever API endpoint they
configure in Settings — hosting is still just "serve these files over
HTTPS," no backend involved. A few good options, roughly easiest first:

## 1. 

## 2. Vercel
1. `npm i -g vercel` (needs Node.js installed)
2. In the folder containing the files, run `vercel --prod`
3. Follow the prompts — no config file needed for static files

## 3. GitHub Pages (free, good if you already use GitHub)
1. Create a new repo, e.g. `abion-forge`
2. Add all 6 files to the repo root, commit, push
3. Repo → Settings → Pages → Source: "Deploy from a branch" → `main` / `root`
4. Your app is live at `https://<username>.github.io/abion-forge/`

## 4. Cloudflare Pages
1. https://dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets
2. Drag in the folder
3. Live at `https://<project>.pages.dev`


## Installing it as an app (PWA)
Once hosted over **HTTPS** (required — the service worker won't register
over plain HTTP, `localhost` is the one exception for local testing):
- **Desktop Chrome/Edge**: an install icon appears in the address bar
- **Android Chrome**: browser menu → "Install app" / "Add to Home screen"
- **iOS Safari**: Share button → "Add to Home Screen" (uses the Apple
  touch icon; iOS ignores the manifest's own install prompt but this
  still gives a real home-screen icon and standalone window)

Once installed, the app shell (the HTML/CSS/JS itself) is cached by the
service worker, so it opens even with a flaky or no connection. Actual
chat requests to your configured API always go straight to the network —
those aren't and shouldn't be cached.

## A note on the API key and CORS
- The API key the user enters in Settings is stored only in their
  browser's `localStorage` — it is never sent to whatever host you use
  above, only to the API base URL they configure.
- Some APIs (NVIDIA NIM, OpenRouter, etc.) allow direct browser calls;
  others block cross-origin requests (CORS) from arbitrary domains.
  If "Test connection" in Settings fails with a CORS-looking error,
  the fix is a small server-side proxy that forwards the request and
  adds the key — happy to build one (e.g. a single Cloudflare Worker
  or Vercel serverless function) if you hit that wall with a specific
  provider.
- Because everything is client-side, there's no backend to secure or
  pay for beyond static file hosting, which is free on all the options
  above.

## Updating after the initial deploy
- Netlify Drop / Cloudflare Pages upload: just drag the new files in
  again to redeploy.
- GitHub Pages / Vercel: commit the updated files and push — both
  redeploy automatically.
- **Important for PWA users**: bump `CACHE_NAME` in `sw.js` (e.g.
  `abion-forge-v1` → `abion-forge-v2`) whenever you redeploy meaningful
  changes. The service worker caches the app shell, so without a version
  bump, people who already installed the app may keep seeing the old
  cached version for a while instead of your update.