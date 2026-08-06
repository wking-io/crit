# Developer canvas module

This module is a local-first tldraw canvas for arranging and interacting with
live URLs. It is intentionally split at one seam:

```ts
type CanvasRepository = {
	read(canvasId: string): Promise<CanvasSnapshot>
	dispatch(canvasId: string, command: CanvasCommand): Promise<CanvasSnapshot>
}
```

`DevCanvas` owns canvas behavior, frame synchronization, polling, persistence,
and fullscreen interaction. Callers only provide a canvas ID. The included
client repository uses the local Vite adapter when available and falls back to
browser storage in a deployed build.

The current host adapter lives in `other/dev-canvas/`. It reads active routes
from Portless, persists URL manifests under `.dev-canvas/`, exposes them to the
client during local development, and provides the `npm run canvas` command for
agents.

## Agent workflows

Open one canvas containing the main app and all worktree-prefixed iterations:

```sh
npm run canvas -- open checkout-review --iterations storefront
```

Open a canvas containing active Portless routes matched by arbitrary text:

```sh
npm run canvas -- open mobile-review --match mobile
```

Add one or more URLs to a named canvas:

```sh
npm run canvas -- add checkout-review \
  https://fix-copy.storefront.localhost \
  https://new-layout.storefront.localhost
```

The open canvas polls the same manifest, so agent-authored changes appear
without a refresh.

## Extraction

To move this into a package:

1. Move `app/modules/dev-canvas` into a package and export `DevCanvas`, the
   model types, and a repository factory.
2. Move `other/dev-canvas` into a Node-only adapter package or keep it in the
   host application.
3. Register the host's route and Vite plugin.
4. Supply another `CanvasRepository` adapter when durable or collaborative
   persistence is needed.

The Portless state format and filesystem access are confined to the host
adapter; neither leaks into the reusable canvas module.
