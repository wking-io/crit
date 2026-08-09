# Crit

Crit is a local-first infinite canvas for arranging live web iterations as
Frames, preserving important versions as immutable snapshots, and reviewing
them with plain-text Notes. It is designed for one person
working with multiple local browser windows and agents, with no collaboration
server or canvas framework to configure.

## Install

Initialize Crit in a Vite + React project:

```sh
npx @riff-refine/crit init
```

The initializer installs the package, adds the Vite plugin and reusable React
surface, creates a discovery manifest, ignores local `.crit/` data, and installs
the Crit agent skill. The Vite plugin serves `/crit/:canvasId?` directly, so the
editor works without modifying or depending on the host application's router.

Or configure it directly:

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { crit } from "@riff-refine/crit/vite"

export default defineConfig({
  plugins: [crit()]
})
```

```tsx
import { Crit } from "@riff-refine/crit"

export function ReviewCanvas() {
  return <Crit canvasId="homepage" />
}
```

The plugin is active only during Vite serve and preview. It can be gated with
`crit({ enabled: mode !== "production" })`. A missing Canvas is created on first
load by default; use `createIfMissing: false` to require explicit creation. The
automatic editor route can be moved or disabled with `editorPath`.

## Discovery

Declare Frames without hard-coding the running origin:

```json
{
  "schemaVersion": 1,
  "id": "storefront",
  "canvases": [
    {
      "id": "checkout-review",
      "title": "Checkout review",
      "frames": [
        {
          "id": "candidate",
          "url": "/checkout",
          "title": "Checkout candidate",
          "status": "in-progress"
        }
      ]
    }
  ]
}
```

Vite publishes the resolved manifest at `/.well-known/crit.json` and reconciles
declared Frames before opening a Canvas. Agents can do the same:

```sh
npx @riff-refine/crit sync --from https://storefront.localhost --json
```

Manifest reconciliation is additive. Stable Frame IDs update in place; omitted
Frames and attached Notes remain until explicitly removed.

## Agent and CLI editing

Agents can read and atomically edit the same files as open browser windows:

```sh
npx @riff-refine/crit list --json
npx @riff-refine/crit open checkout-review --json
npx @riff-refine/crit apply checkout-review \
  '[{"_tag":"SetFrameStatus","id":"candidate","status":"approved"}]' \
  --json
npx @riff-refine/crit snapshot checkout-review candidate --json
npx @riff-refine/crit activity checkout-review \
  --for 120 --detail "Refining checkout" --json
```

The command schema includes Frame operations (`AddFrame`, `UpdateFrame`,
`SetFrameStatus`, `MoveFrame`, `ResizeFrame`, `RemoveFrame`) and Note operations
(`AddNote`, `UpdateNote`, `MoveNote`, `ResizeNote`, `AttachNote`, `DetachNote`,
`RemoveNote`). Frames and Notes also expose `Bring…ToFront` and `Send…ToBack`
commands against one shared stacking order. Related commands commit as one batch. Per-Canvas filesystem locks
serialize local writers against the latest revision, so unrelated agent and
browser edits merge without manual revision wiring.

Canvas Documents live under `.crit/canvases`. Use Crit commands and interfaces
instead of editing those files directly.

CLI commands that work on a Canvas automatically publish a short local activity
pulse. Before a longer task, agents can renew that signal with `crit activity
<canvas> --for <seconds> --detail <work>` and clear it with `--clear`. Open
editors show a purple **Agent working** indicator, and poll authoritative Canvas
revisions every 500 ms while the signal is active instead of the normal
two-second fallback. Activity files under `.crit/activity` expire automatically;
they are coordination hints, not Canvas history or durable presence.

## Frame snapshots

Choose **Take snapshot** on a live Frame, or run `crit snapshot <canvas> <frame>`.
Crit fetches that Frame's current page, bundles and minifies its HTML, CSS, and
JavaScript, inlines fetched resources, and stores one immutable HTML artifact in
`.crit/snapshots`. The live Frame remains in place and a separate archived Frame
is added beside it, with its source URL, capture time, artifact ID, and size.

The Vite plugin serves artifacts under `/__crit/snapshots/<artifact-id>` with
immutable cache headers. Capture currently supports HTTP and HTTPS Frames and
limits an individual fetched resource to 12 MiB, the final artifact to 30 MiB,
and a whole capture — including every resource fetch — to 60 seconds. This is
page preservation, not an asset upload system; V1 still has no user-managed
uploads.

## Browser behavior

The React viewport supports infinite pan/zoom, Frame and Note drag/resize,
review status, editable Notes, and attachment by dropping a Note onto a Frame.
Dragging it away detaches it without changing its Canvas position. Attached
Notes move with their Frame. Frame toolbars retain a stable screen size while
zooming and progressively hide title and secondary controls when space becomes
tight. Frame and Note headers include send-to-back and bring-to-front controls.
Offscreen iframes are paused for performance.

Global shortcuts are registered through TanStack Hotkeys: `V` selects the
Select tool, `H` selects the Hand tool, and `Mod++` / `Mod+-` zoom the Canvas.
Single-key tool shortcuts are ignored while typing in inputs. The same behavior
is preserved while focus is inside a live Frame.

The Vite-served editor includes development-only DialKit panels for tuning
Frame chrome and zoom physics. The zoom panel controls wheel and pinch
sensitivity, keyboard impulse, exponential decay, maximum speed, and the speed
at which motion comes to rest. Values and presets persist locally; applications
can also pass the same values through the `frameChrome` and `zoomPhysics` props
on `<Crit>`.

Live Frame review states are **In progress**, **Ready for review**, **Approved**,
and **Changes requested**. Ready-for-review Frames receive a distinct purple
border, header treatment, and status indicator; archived snapshots remain a
separate immutable state.

Autosave is single-flight and stores pending semantic commands in IndexedDB for
draft recovery. Vite file watching refreshes clean windows immediately after a
browser or agent write; a two-second poll remains a fallback. Dirty local work
is never replaced by refresh. Active agent sessions temporarily tighten that
fallback to 500 ms. Use `refreshInterval={false}` to disable polling.

Iframe capabilities are configurable:

```tsx
<Crit
  canvasId="homepage"
  iframeAllow="clipboard-read; clipboard-write; fullscreen"
  iframeSandbox="allow-scripts allow-same-origin allow-forms"
/>
```

Pass `draftJournal={false}` to disable recovery, a custom `CritClientShape` for
another local HTTP host, or `onSession` to access `dispatch`, `flush`, `refresh`,
and `snapshotFrame` directly.

Headless consumers can import the Effect v4 domain engine:

```ts
import { Canvas, CanvasCommand } from "@riff-refine/crit/core"
```

Before publishing, run `npm run verify`. It typechecks, tests, packs the module,
installs it in an isolated consumer, builds the React entry point, imports every
public adapter, and exercises the installed CLI.

## Local feature playground

Run the source-backed visual test app from this repository:

```sh
npm run dev:portless
```

Open `https://crit.localhost` for the feature guide or
`https://crit.localhost/crit/feature-lab` for the pre-populated Canvas. Portless
registers the stable hostname and chooses the backing port. The app
uses the real Vite plugin, four real local Frame pages, filesystem persistence,
manifest discovery, Notes, every review state, snapshots, and agent activity.

Use `npm run dev` when you want direct Vite without Portless; it defaults to
`http://127.0.0.1:5173`.

In another terminal, agents can edit the exact same Canvas:

```sh
npm run dev:agent -- open feature-lab --json
npm run dev:agent -- activity feature-lab --for 120 --detail "Testing agent edits" --json
```

See [playground/README.md](playground/README.md) for the complete browser and
agent checklist. Playground state persists in ignored `playground/.crit` data.
