# Crit

Crit is a local-first React canvas for arranging and assessing live web
iterations. It uses one tldraw Store as the live document, Effect v4 for typed
runtime seams, single-flight autosave, and browser draft recovery.

Initialize Crit in a Vite + React project:

```sh
npx @riff-refine/crit init
```

The initializer installs the package, updates Vite without replacing existing
plugins, creates the React surface, adds `.crit/` to `.gitignore`, and installs
the project agent skill. React Router framework projects also receive a
registered `/crit/:canvasId?` route. Other routers get an explicit component
mount instruction rather than a guessed mutation.

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

Use `--skip-install` when dependency installation is managed separately, and
`--json` for machine-readable initialization results.
