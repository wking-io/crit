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

Ordinary production stays out of this folder.
