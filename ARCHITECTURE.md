# Architecture

Crit is a local canvas for live web Frames and plain-text Notes. Its V1 design
optimizes for one person working with multiple local browser windows and agents.
It deliberately excludes remote collaboration, presence, CRDTs, authentication,
freehand drawing, generic shapes, and asset upload.

## Domain core

`Canvas` is the platform-neutral authority for the Canvas Document, validation,
summaries, and semantic commands. The durable document contains only identity,
revision, Frames, and Notes. Camera, selection, iframe state, and other viewport
details are browser-session state and are never persisted.

Frames own URL, title, review status, provenance, geometry, display policy, and
stacking order. An archived Frame additionally owns immutable snapshot metadata:
artifact ID, original URL, capture time, and byte size. Notes own text, geometry,
optional Frame attachment, and stacking order. Attached Notes use absolute
Canvas coordinates; moving their Frame moves them by the same delta, and
detaching preserves their position. Removing a Frame also removes its attached
Notes.

Every mutation is an atomic semantic command batch. The core applies a batch to
a draft and publishes it only if every command succeeds. Conflicts are expressed
at the narrowest meaningful boundary: for example, `UpdateNote` includes the
expected prior text, while unrelated commands can safely serialize.

## Local coordination

`CanvasRepository` is the durable boundary. The filesystem implementation stores
one JSON document per Canvas under `.crit/canvases`, acquires a per-Canvas lock,
loads the latest revision, applies the command batch, increments the revision,
and atomically renames the result into place. Browser and CLI agent writes use
this exact path, so concurrent local writers do not race through separate models.

`SnapshotArchive` is a separate binary-artifact boundary. Its filesystem adapter
captures a live HTTP(S) page, bundles and minifies HTML/CSS/JavaScript, inlines
fetched resources, and atomically stores self-contained HTML under
`.crit/snapshots`. `SnapshotService` coordinates capture with the repository by
committing an `AddSnapshotFrame` command that checks the source Frame still has
the URL that was captured. The live Frame is retained; its archived Frame points
to the immutable artifact. Snapshot bytes do not bloat the Canvas Document.

CLI and discovery adapters use the Canvas Repository directly and derive views
through the Canvas core. `CanvasSession` adds optimistic browser state,
single-flight autosave, semantic-command draft recovery, and revision adoption.
The Vite plugin watches the Canvas directory and sends change hints to browser
windows; polling remains a fallback. Notifications are only an optimization—the
file and its revision are authoritative.

`AgentActivityStore` is a separate ephemeral coordination boundary. Its
filesystem adapter writes renewable, automatically expiring signals under
`.crit/activity`; those files never enter the Canvas Document or revision
history. The CLI emits short pulses for Canvas work and exposes an explicit
renew/clear command for longer sessions. Browser sessions read the signal through
the HTTP adapter, show activity without implying remote presence, and tighten
revision polling from two seconds to 500 ms while an agent is active. Vite file
events remain the immediate path.

## UI and adapters

`CanvasViewport` is a Crit-owned DOM viewport. It implements infinite pan/zoom,
Frame and Note movement and resizing, review status, note editing and
attach/detach behavior. Offscreen iframes are not mounted, keeping the cost tied
to visible work. The iframe `allow` and `sandbox` policies are configurable.
Global Canvas shortcuts are centralized through TanStack Hotkeys. The iframe
input bridge only transports input intent—keyboard shortcuts, wheel, pinch,
and pointer selection—across document and origin boundaries; shortcut matching
and actions remain owned by the React viewport.

The HTTP adapter supports `GET` for authoritative documents and agent activity,
`PATCH` for semantic command batches, and `POST` on a Frame snapshot route. Vite adapts it
to local Connect middleware, owns the router-independent Crit editor route, and
serves immutable snapshot artifacts. The React
component, Vite plugin, CLI, discovery manifest, and installed agent skill are
thin adapters around the same core, repository, and archive boundaries.

Effect v4 owns schemas, typed failures, services, Layers, concurrency, and scoped
lifecycle. Pure synchronous document transitions remain ordinary TypeScript.

## Deferred extensions

The command boundary can later support an MCP or codemod service without granting
raw file mutation. The repository boundary can later gain another local adapter.
Remote multi-user collaboration would be a separate architecture and is not
implied by the V1 interfaces.
