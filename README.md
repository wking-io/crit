# Crit

Crit is a local-first React canvas for arranging and assessing live web
iterations. It uses one tldraw Store as the live document, Effect v4 for typed
runtime boundaries, single-flight autosave, and browser draft recovery.

The React entry point owns the editor lifecycle and required tldraw styles:

```tsx
import { Crit, type CritClientShape } from "@riff-refine/crit"

const client: CritClientShape = {
  load: (canvasId) => loadCanvas(canvasId),
  save: (document, expectedRevision) =>
    saveCanvas(document, expectedRevision)
}

export function ReviewCanvas() {
  return <Crit canvasId="homepage" client={client} />
}
```

`client` is the transport boundary. It can target Vite middleware or a
different HTTP runtime without changing editor ownership. Draft recovery
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
