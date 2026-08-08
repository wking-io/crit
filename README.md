# Crit

Crit is a local-first React canvas for arranging and assessing live web
iterations. It uses one tldraw Store as the live document, Effect v4 for typed
runtime boundaries, single-flight autosave, and browser draft recovery.

Add the Vite plugin. It owns the local HTTP adapter and stores Canvas Documents
under `.crit/canvases`:

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { crit } from "@riff-refine/crit/vite"

export default defineConfig({
  plugins: [crit()]
})
```

The adapter runs only during Vite serve/preview. It can also be gated explicitly
with `crit({ enabled: mode !== "production" })` from a functional Vite config.

The React entry point then owns the editor lifecycle and required tldraw styles:

```tsx
import { Crit } from "@riff-refine/crit"

export function ReviewCanvas() {
  return <Crit canvasId="homepage" />
}
```

The Vite adapter creates a missing Canvas on first load. Pass
`crit({ createIfMissing: false })` when creation must remain explicit.

`client` remains the transport seam. Pass a custom `CritClientShape` to target
another HTTP runtime without changing editor ownership. Draft recovery
uses IndexedDB by default and a tab-stable session ID; pass `draftJournal={false}`
to disable it or provide another journal implementation.

Headless consumers can import the platform-neutral engine without React:

```ts
import { Canvas } from "@riff-refine/crit/core"
```

The eventual installation golden path is:

```sh
npx @riff-refine/crit init
```
