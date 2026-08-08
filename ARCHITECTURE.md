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

Filesystem and D1 stores implement one `DocumentStore` contract. React owns a
scoped optimistic `CanvasSession`; Vite and Cloudflare expose one shared HTTP
contract. CLI, React, HTTP, and future MCP integrations call the same semantic
Canvas commands and never edit raw storage or tldraw records.

V1 deliberately excludes Asset ingestion, real-time collaboration,
authentication, and remote MCP mutation.

