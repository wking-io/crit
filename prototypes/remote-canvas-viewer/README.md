# Remote canvas viewer prototype

Throwaway. Not the rewrite. Not alpha. Not a package.

## Question

Can a Cloudflare Worker canvas host on one origin show a live application Worker on a different origin inside a Frame?

## Run

```
cd prototypes/remote-canvas-viewer
npm start
```

Open `http://127.0.0.1:8787`. That origin is the canvas. The Frame points at `http://127.0.0.1:8788/checkout`. Port is part of the origin, so these are two sites.

## Variants

- **Checkout.** Allowed `frame-ancestors`. The live shop should appear and the panel should say `live`.
- **Account.** Another application route on the same preview origin.
- **Locked.** `X-Frame-Options: DENY`. The Frame stays blank and the panel says `blocked`.

## Deploy

Two Workers. Set each origin on the other after the first deploy.

```
cd prototypes/remote-canvas-viewer/app
npx wrangler deploy --temporary --var CANVAS_ORIGIN:https://example.com

cd ../canvas
npx wrangler deploy --temporary --var APP_ORIGIN:https://<app-worker>.workers.dev

cd ../app
npx wrangler deploy --temporary --var CANVAS_ORIGIN:https://<canvas-worker>.workers.dev
```

A temporary `workers.dev` host wraps both origins in Turnstile. The challenge page sends `X-Frame-Options: SAMEORIGIN`, so the app origin cannot pass that check inside a Frame. Use a permanent Cloudflare account for a clean iframe prove.

## Access

Temporary `workers.dev` accounts cannot enable Zero Trust. This folder mocks the documented Access path on three sites so Chrome can answer the Frame question without a real org.

```
cd prototypes/remote-canvas-viewer
npm run access
```

Open `http://127.0.0.1:8797`. The Frame points at `http://localhost:8798/checkout`. Different hostnames, so this is cross-site, not just cross-origin. Unauthenticated preview requests 302 to `http://127.0.0.1:8799`, which stands in for `team.cloudflareaccess.com`.

```
ACCESS_ALLOW_IFRAME=0 npm run access
ACCESS_SAMESITE=lax npm run access
npm run prove:access
```

`allow_iframe` off sends `X-Frame-Options: SAMEORIGIN` on the login page. On sends `frame-ancestors` for the canvas. After sign-in the preview sets `CF_Authorization` with `HttpOnly`, `Secure`, and `SameSite=None` unless `ACCESS_SAMESITE=lax`. Those are the documented Access defaults.

Live Workers on the logged-in account, no Turnstile:

- Canvas `https://proto-remote-canvas.contact-1c8.workers.dev`
- App `https://proto-remote-app.contact-1c8.workers.dev`

Wrangler OAuth can deploy those. It cannot create or edit Access apps. An Account API token with Access: Apps and Policies Edit can. After `allow_iframe` and CORS for the canvas origin, the Access login page drops `X-Frame-Options` and `frame-ancestors 'none'`. The login renders inside the canvas Frame. The canvas marks that `gate` on iframe load. Real Access does not send the mock `proto-access` postMessage.

Sign in with Cloudflare leaves that page for `dash.cloudflare.com/oauth2/auth`. That host sends `X-Frame-Options: SAMEORIGIN`, so the Frame becomes `chrome-error://chromewebdata/`. The Access login can sit in the Frame. The Cloudflare account IdP cannot. First sign-in for that IdP has to happen top-level. `CF_Authorization` is SameSite None after that, so the Frame can reuse the cookie.

```
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export ACCESS_TEST_EMAIL=you@company.com
node scripts/access-setup.mjs
```

Ordinary production stays out of this folder.
