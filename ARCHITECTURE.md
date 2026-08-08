# Architecture

Crit is one deep npm package with a no-configuration React/Vite path and narrow
escape hatches for other runtimes.

The Canvas Document is the only durable truth. It wraps a complete,
schema-bearing tldraw document in a small Crit identity and revision envelope.
Frames are validated `crit-frame` custom shapes; Annotations are ordinary
non-Asset tldraw records. Session state such as camera, selection, active tool,
and undo history is not durable.

The platform-neutral core owns Canvas creation, opening, semantic commands,
export, migration, validation, and summaries. Effect v4 owns schemas, typed
failures, services, Layers, concurrency, and lifecycle. Synchronous in-memory
document transitions remain pure TypeScript.

Filesystem and D1 stores implement one `DocumentStore` contract. The D1 adapter
uses conditional SQLite writes as the concurrency boundary and keeps its schema
in a packaged, versionable migration. React owns a scoped optimistic
`CanvasSession`. A Web Request/Response module owns the shared HTTP contract;
Vite adapts it to Connect middleware and the Cloudflare adapter composes it into
an existing Worker without owning the application's fallback response.

Cloudflare bindings enter through a small structural interface rather than a
runtime dependency. The request adapter receives the D1 binding per invocation,
can be gated from deployment environment state, and returns `null` when disabled
or when a request belongs to the host application. Its schema initialization
cache is an optimization only; correctness remains in D1 and migrations.

CLI and future agent integrations express changes as semantic Canvas commands.
The Session persists validated Canvas Document envelopes with optimistic
revision checks. Neither path edits raw storage records.

The discovery module validates versioned manifests, resolves relative Frame
locations, and reconciles them through `CritRuntime`. Its interface is shared by
the Vite and CLI adapters. Reconciliation is additive: stable Frame identities
are updated in place, while absent Frames and their annotations are preserved
until an explicit removal command is issued.

The Session owns convergence as well as persistence. It polls through the
`CritClient` seam and adopts a newer Canvas Document only while local state is
clean. Adoption replaces document-scoped records inside the existing tldraw
Store, preserving mounted editor/session state. Dirty or racing local changes
defer adoption and continue through the existing optimistic conflict path.

`crit init` owns installation-time integration. It applies idempotent,
recognizable transforms to Vite and React Router configuration, creates narrow
host files, and preserves files whose contents it does not own. Router shapes
it cannot recognize become explicit follow-up instructions instead of guessed
edits.

V1 deliberately excludes Asset ingestion, real-time collaboration,
authentication, and remote MCP mutation.
