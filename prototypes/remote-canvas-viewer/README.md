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
wrangler deploy --var CANVAS_ORIGIN:https://proto-remote-canvas.<account>.workers.dev

cd ../canvas
wrangler deploy --var APP_ORIGIN:https://proto-remote-app.<account>.workers.dev
```

Then set `CANVAS_ORIGIN` on the app Worker to the real canvas URL.

Ordinary production stays out of this folder.
