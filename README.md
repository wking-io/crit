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

The initializer first verifies the current user's Git Author identity, then
installs the package, Vite plugin, reusable React surface, discovery manifest,
ignore rule, general Crit skill, and independent `crit-identity` skill. The Vite
plugin serves `/crit/:canvasId?` directly, so the editor works without modifying
or depending on the host application's router.

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
`crit({ enabled: mode !== "production" })`. Canvas loading is read-only: create
Canvases explicitly with `crit create` or `crit sync` before opening them. The
automatic editor route can be moved or disabled with `editorPath`.

### Vite plugin options

| Option | Purpose |
| --- | --- |
| `enabled` | Enables the plugin; defaults to `true`. |
| `root` | Directory containing `.crit` data and the discovery manifest; defaults to Vite's resolved root. |
| `apiPath` | Base path for the Canvas HTTP API; defaults to `/__crit/api`. |
| `manifest` | Manifest filename relative to `root`; defaults to `crit.manifest.json`. Set it to `false` to disable discovery. |
| `manifestPath` | URL that publishes the resolved manifest; defaults to `/.well-known/crit.json`. |
| `editorPath` | URL prefix for the standalone editor; defaults to `/crit`. Set it to `false` to disable the editor. |
| `frameInputBridge` | Injects the script that forwards input from same-origin live Frames; defaults to `true`. |

When the standalone editor is enabled, Crit reserves
`<editorPath>/__assets/editor.js` for its generated browser bundle. This is an
internal route managed by the plugin, not a separately configurable asset URL.

### React component

`<Crit>` accepts these props:

| Prop | Purpose |
| --- | --- |
| `canvasId` | Canvas to open. Required. |
| `canvasChoices` | Optional `{ id, title }` choices shown by the Canvas title switcher. |
| `onCanvasSelect` | Called with the selected Canvas ID. Supply with `canvasChoices` to enable the switcher. |
| `services` | Explicit `{ client, snapshots, activity }` service bundle; use `null` for unsupported optional capabilities. Overrides `apiPath`. |
| `apiPath` | Base path used by the default HTTP client; defaults to `/__crit/api`. |
| `autosaveDelay` | Effect `Duration.Input` debounce before saving; defaults to 100 ms. |
| `refreshInterval` | Effect `Duration.Input` polling interval; defaults to two seconds. Use `false` to disable polling. |
| `presenceRefreshInterval` | Canvas Presence polling interval; defaults to five seconds. Use `false` to disable fallback polling. |
| `sessionId` | Stable writer ID. By default, Crit creates one per Canvas and browser tab session. |
| `draftJournal` | Custom `DraftJournal["Service"]`. IndexedDB is used by default; use `false` to disable draft recovery. |
| `className`, `style` | Class and inline styles applied to the root, loading, or error container. |
| `iframeAllow`, `iframeSandbox` | Capability and sandbox attributes for live Frames. |
| `frameChrome` | Partial `FrameChromeSettings` controlling title and action width thresholds. |
| `cameraOptions` | Partial `CanvasCameraOptions` controlling pan speed, zoom speed, zoom steps, and wheel behavior. |
| `onSession` | Receives the opened `CanvasSession` handle. |
| `onCommandError` | Receives a user-command failure message. |
| `loadingFallback` | React content shown while the Canvas opens. |
| `errorFallback` | Renders React content from a Canvas-open failure message. |

The main entry point exports `CritProps`, `CanvasChoice`, `FrameChromeSettings`,
`CanvasCameraOptions`, `CanvasWheelBehavior`, and the default frame-chrome and
camera option values for typed configuration.

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

Vite publishes the resolved manifest at `/.well-known/crit.json`. Reconcile its
declared Canvases and Frames explicitly:

```sh
npx @riff-refine/crit sync --from https://storefront.localhost --json
```

Manifest reconciliation is additive. Stable Frame IDs update in place; omitted
Frames and attached Notes remain until explicitly removed.

## Agent and CLI editing

Agents can read and atomically edit the same files as open browser windows:

```sh
npx @riff-refine/crit list --json
npx @riff-refine/crit identity --json
npx @riff-refine/crit open checkout-review --json
npx @riff-refine/crit apply checkout-review \
  '[{"_tag":"SetFrameStatus","id":"candidate","status":"approved"}]' \
  --json
npx @riff-refine/crit snapshot checkout-review candidate --json
npx @riff-refine/crit activity checkout-review \
  --id codex-thread-1 --harness Codex --model GPT-5 \
  --detail "Refining checkout" --json
```

### CLI reference

All commands accept `--json` for machine-readable output where applicable.

| Command | Purpose and options |
| --- | --- |
| `crit init` | Configure a Vite + React project. Use `--root <directory>` to target another project and `--skip-install` to leave dependency installation to the caller. |
| `crit identity` | Verify the Git Author used by Crit. Use `--root <directory>` to target another repository. |
| `crit sync` | Reconcile a manifest. Use `--from <file-or-url>`, `--base-url <url>` to resolve relative Frame URLs in a local manifest, and `--canvas <id>` to sync one Canvas. |
| `crit create <id> --title <title>` | Create an empty Canvas. |
| `crit add <canvas> <url...>` | Add one or more HTTP or HTTPS URLs as live Frames. |
| `crit apply <canvas> <commands>` | Atomically apply a JSON array of semantic Canvas commands. |
| `crit snapshot <canvas> <frame>` | Capture a live Frame as an immutable HTML snapshot. |
| `crit activity <canvas>` | Signal a 60-second lease with required `--id` and `--harness`, optional `--model`, `--detail`, and external-reference fields; remove that activity with `--id <id> --clear`. |
| `crit list` | List local Canvases. |
| `crit open <canvas>` | Read a Canvas and its Frames. |

The command schema includes Frame operations (`AddFrame`, `SetFrameSource`,
`SetFrameTitle`, `SetFrameStatus`, `SetFrameDisplay`, `MoveFrame`, `ResizeFrame`,
`RemoveFrame`) and Note operations (`AddNote`, `EditNote`, `MoveNote`,
`ResizeNote`, `AttachNote`, `DetachNote`, `RemoveNote`). Comment operations are `AddCommentThread`,
`ReplyToCommentThread`, `EditComment`, `SetCommentThreadResolved`, and
`UpdateCommentAnchor`. Frames and Notes also expose `Bring…ToFront` and `Send…ToBack`
commands against one shared stacking order. Related commands commit as one batch. Per-Canvas filesystem locks
serialize local writers against the latest revision, so unrelated agent and
browser edits merge without manual revision wiring.

Every Note records its Author. `EditNote` and `RemoveNote` require that Author's
actor ID; collaborators can still move, reorder, attach, detach, and resize its
width. Note height is measured from its rendered text, and removing a Frame
detaches its Notes without deleting them.

Agents leave Comments through the same `apply` surface. Use `crit identity
--json` to verify the Current Author; do not invent another person's identity.
Canvas creation stores that Author as immutable Canvas Owner. `crit open
<canvas> --json` returns the Owner and full active and resolved thread history.
Frame-coordinate anchors work for every live Frame, while element anchors are
created by the instrumented browser UI and may be reused or re-anchored by their
owner. Archived snapshot Frames reject Comments.

Canvas Documents live under `.crit/canvases`. Use Crit commands and interfaces
instead of editing those files directly.

Only harnesses publish Agent Activity. Each run renews its stable activity ID
about every 20 seconds and clears it on clean completion. Open editors combine
the Current Author and active runs into letter avatars with hover details for
harness, model, work, and supported desktop/web references. Presence refreshes
on Vite events with a five-second fallback, independently from Canvas Document
polling. Per-activity files under `.crit/activity/<canvas>/<activity>.json`
expire after 60 seconds; they are coordination hints, not Canvas history.

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
Notes move with their Frame. An open Comment Thread stays on the left edge of
its live Frame and moves with that Frame. Frame toolbars retain a stable screen size while
zooming and progressively hide title and secondary controls when space becomes
tight. A live Frame's saved width and height belong to the iframe viewport, not
its toolbar: responsive layout stays fixed at that configured size while the
complete Frame representation follows the Canvas camera transform. Frame and
Note headers include send-to-back and bring-to-front controls. Offscreen iframes
are paused for performance.

Global shortcuts are registered through TanStack Hotkeys: `V` selects the
Select tool, `H` selects the Hand tool, and `Mod++` / `Mod+-` zoom the Canvas.
Single-key tool shortcuts are ignored while typing in inputs. The same behavior
is preserved while focus is inside a live Frame.

A persistent help panel in the bottom-left corner shows the name, hotkey, and
description for the control currently hovered or focused. Updates are immediate
and cover canvas tools, Frame and Note controls, context menus, and dialogs.

The Vite-served editor includes development-only DialKit panels for tuning
Frame chrome and camera pan/zoom speed. Camera input follows the same immediate
model across wheel, trackpad, touch pinch, and Frame bridges; keyboard zoom uses
discrete steps. Two-finger trackpad scrolling pans the Canvas and trackpad pinch
zooms around the pointer even while the pointer is over live Frame content.
Values and presets persist locally. Applications can pass
`frameChrome` and `cameraOptions` to `<Crit>`; camera options also control wheel
behavior and the ordered zoom steps that define the minimum and maximum zoom.

Live Frame review states are **In progress**, **Ready for review**, **Approved**,
and **Changes requested**. Ready-for-review Frames receive a distinct purple
border, header treatment, and status indicator; archived snapshots remain a
separate immutable state.

Autosave is single-flight and stores pending semantic commands in IndexedDB for
draft recovery. Vite file watching refreshes clean windows immediately after a
browser or agent write; a two-second poll remains a fallback. Dirty local work
is never replaced by refresh. Canvas Presence uses its own five-second fallback
and never changes document polling. Use `refreshInterval={false}` to disable
document polling.

Iframe capabilities are configurable:

```tsx
<Crit
  canvasId="homepage"
  iframeAllow="clipboard-read; clipboard-write; fullscreen"
  iframeSandbox="allow-scripts allow-same-origin allow-forms"
/>
```

When `iframeSandbox` is not set, archived Frames render their Snapshot
Artifact with `sandbox="allow-scripts"` so captured foreign scripts never run
same-origin with the host application; live Frames stay unsandboxed.

Pass `draftJournal={false}` to disable recovery, a custom `services` bundle for
another transport, or `onSession` to access `dispatch`, `flush`, `refresh`, and
`snapshotFrame` directly.

### Package entry points

| Entry point | Intended use |
| --- | --- |
| `@riff-refine/crit` | React `<Crit>` surface, browser/session clients, and core domain exports. |
| `@riff-refine/crit/core` | Platform-neutral Effect domain model, schemas, and commands. |
| `@riff-refine/crit/http` | HTTP contract, route helpers, request handler, and HTTP client. |
| `@riff-refine/crit/discovery` | Discovery manifest schemas, resolution, and reconciliation. |
| `@riff-refine/crit/node` | Node filesystem repositories, activity and snapshot services, and their service contracts. |
| `@riff-refine/crit/vite` | Vite plugin and `CritVitePluginOptions`. |

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

Open `https://crit.localhost` for the pre-populated feature-lab Canvas. Portless
registers the stable hostname and chooses the backing port. On first use,
macOS may request administrator access so Portless can bind standard HTTPS port
443; accepting that prompt is what makes the URL work without a port. The app
uses the real Vite plugin, four real local Frame pages, filesystem persistence,
manifest discovery, Notes, every review state, snapshots, and agent activity.

Use `npm run dev` when you want direct Vite without Portless; it defaults to
`http://127.0.0.1:5173`. Both commands serve the Crit editor from the package's
source through Vite, so changes under `src/react` update the open playground
without rebuilding or restarting it.

In another terminal, agents can edit the exact same Canvas:

```sh
npm run dev:agent -- open feature-lab --json
npm run dev:agent -- activity feature-lab --id dev-agent --harness Terminal --detail "Testing agent edits" --json
```

See [playground/README.md](playground/README.md) for the complete browser and
agent checklist. Playground state persists in ignored `playground/.crit` data.
