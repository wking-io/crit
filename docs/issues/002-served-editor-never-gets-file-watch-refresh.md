# Live-refresh hint channel is dead in the served editor

**Severity:** High · **Area:** Vite plugin / React entry (`src/vite/index.ts`, `src/react/crit.tsx`)

## Problem

README promises "Vite file watching refreshes clean windows immediately after a
browser or agent write." The plugin sends `crit:canvas-changed` over `server.ws`
(`src/vite/index.ts:384-390`) and `<Crit>` subscribes via `import.meta.hot`
(`src/react/crit.tsx:204-237`).

But the flagship surface — the served `/crit/:canvasId` editor — is a static
HTML shell (`src/vite/index.ts:172-185`) whose script is a pre-built esbuild
bundle served directly by middleware (`:456-478`). That bundle contains no Vite
client, so `import.meta.hot` is `undefined` there and the hint channel is dead.
The standalone editor only ever refreshes via the 2 s / 500 ms poll. Only host
apps that mount `<Crit>` from Vite-transformed source get the immediate path.

## Proposed fix

Options, roughly in order of preference:

1. Have the editor bundle open its own WebSocket to Vite's HMR endpoint (the
   protocol is stable and the plugin controls both ends), listening for the
   custom events only.
2. Serve the editor entry through Vite's module graph (a virtual module) so the
   real Vite client is present, instead of a parallel esbuild bundle.
3. Downgrade the README claim for the served editor.

Add an integration test that writes a Canvas file and asserts an open served
editor receives the change hint without waiting for the poll.

## Origin

Spec review ("Looks Wrong", worst finding on that axis) of the 2026-08-09
architecture and code review.
