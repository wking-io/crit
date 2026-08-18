# Architecture

Crit is a local canvas for live web Frames and plain-text Notes. Its V1 design
optimizes for one person working with multiple local browser windows and agents.
It deliberately excludes remote collaboration, remote-user presence, CRDTs,
freehand drawing, generic shapes, and asset upload. A Canvas Session may open
as a Guest Session until Sign-in establishes a Current Author; that is local
identity for authorship, not a remote authentication provider.

## Domain core

`Canvas` is the platform-neutral authority for the Canvas Document, validation,
summaries, and semantic commands. The durable document contains its creation-time
Owner, revision, Frames, Notes, and any retained Comment records. Camera, selection, iframe state,
and other viewport details are browser-session state and are never persisted.

Frames own URL, title, review status, provenance, geometry, display policy, and
stacking order. An archived Frame additionally owns immutable snapshot metadata:
artifact ID, original URL, capture time, and byte size. Notes own text, geometry,
Author, optional Frame attachment, and stacking order. Attached Notes use absolute
Canvas coordinates; moving their Frame moves them by the same delta, and
detaching preserves their position. Removing a Frame detaches its attached Notes
and preserves their Canvas positions.

Every mutation is an atomic semantic command batch. The core applies a batch to
a draft and publishes it only if every command succeeds. Conflicts are expressed
at the narrowest meaningful boundary: for example, `EditNote` includes the
Author's actor ID and expected prior text, while unrelated arrangement commands
can safely serialize.

## Local coordination

`CanvasRepository` is the durable boundary. The filesystem implementation stores
one JSON document per Canvas under `.crit/canvases`, acquires a per-Canvas lock,
loads the latest revision, applies the command batch, increments the revision,
and atomically renames the result into place. Browser and CLI agent writes use
this exact path, so concurrent local writers do not race through separate models.
The IndexedDB adapter is the same repository for browser-only deployments: it
stores one document per Canvas in the visitor's IndexedDB, seeds missing
documents, and serializes writes per Canvas. Mutations stay on that device.

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

Every Canvas Document has one immutable creation-time Owner. Explicit CLI or
manifest creation resolves that Owner through the Git Author identity service;
loading never creates or assigns ownership. A Canvas Session separately resolves
one Current Author through its client and keeps that identity fixed for the
session lifetime.

`AgentActivityStore` is a separate ephemeral coordination boundary. Its
filesystem adapter writes one 60-second lease per harness-supplied run under
`.crit/activity/<canvas>/<activity>.json`; those files never enter the Canvas
Document, lock, or revision history. Renewals replace descriptive metadata while
preserving run identity and creation time. Browser sessions combine the Current
Author with all active runs as Canvas Presence, refreshed by Vite events with an
independent five-second fallback. Retrieval failures are logged and represented
by anonymous presence rather than an empty agent list.

## UI and adapters

`CanvasViewport` is a Crit-owned DOM viewport. It implements infinite pan/zoom,
Frame and Note movement and resizing, review status, note editing and
attach/detach behavior. Offscreen iframes are not mounted, keeping the cost tied
to visible work. The iframe `allow` and `sandbox` policies are configurable.
Frame geometry is the iframe's configured layout viewport; fixed-screen chrome
is projected outside that height. The complete Frame representation participates
in the Canvas camera transform, so zoom never changes the iframe's responsive
layout or introduces an independent content scale.
Global Canvas shortcuts are centralized through TanStack Hotkeys. The iframe
input bridge only transports input intent—keyboard shortcuts, wheel, pinch,
and pointer selection—across document and origin boundaries. Trackpad pan and
pinch remain Canvas navigation when crossing live Frame content; shortcut
matching and camera actions remain owned by the React viewport.

The HTTP adapter supports `GET` for Current Author, authoritative documents, and Agent Activities,
`PATCH` for semantic command batches, and `POST` on a Frame snapshot route. Vite adapts it
to local Connect middleware, owns the router-independent Crit editor route, and
serves immutable snapshot artifacts. `BrowserCritClient` adapts the same React
surface to IndexedDB for sites that cannot use a Node filesystem. The React
component, Vite plugin, CLI, discovery manifest, and installed agent skill are
thin adapters around the same core, repository, and archive boundaries.

Visible UI icons cross one generated Glyph seam. Individual SVG sources compile
to a renderer-neutral typed map; React roots render uniquely prefixed inline
symbol sheets. Isolated documents such as Frame bridges serialize the same
definitions directly. Sheet ownership belongs to
`GlyphProvider`, so nested and sibling Crit roots cannot create ambiguous global
fragment IDs.

Effect v4 owns schemas, typed failures, services, Layers, concurrency, and scoped
lifecycle. Pure synchronous document transitions remain ordinary TypeScript.

## Deferred extensions

The command boundary can later support an MCP or codemod service without granting
raw file mutation. The repository boundary can later gain another local adapter.
Remote multi-user collaboration would be a separate architecture and is not
implied by the V1 interfaces.
