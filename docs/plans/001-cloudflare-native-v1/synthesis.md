# Architecture synthesis

[Back to the overview](overview.md)

## What changed

The first architecture pass chose a strangler migration because Crit already has a working alpha UI, CLI, filesystem repository, snapshots, and tests. That was the safest way to preserve compatibility.

The product decision changed: compatibility is not a goal. Crit can be rewritten to make the stable v1 as coherent as possible.

## New conclusion

Use the clean target directly:

- Organize the implementation around `CanvasEngine`, `CanvasAuthority`, `CanvasReplica`, `RepresentationRuntime`, and `CodeExecutionRuntime`.
- Establish the final package ownership graph immediately.
- Build on an ordered semantic ledger from the first persisted change.
- Use SQLite for the local authority and one SQLite Durable Object for each shared Canvas.
- Store logical Representations from the first Frame.
- Keep all Actor attribution outside client commands and stamp it at trusted boundaries.
- Make `crit dev` the only local state owner.
- Make the UI and every Agent client consume the same replica and operation contracts.
- Keep Cloudflare and experimental Code Mode details behind adapters.

## What the alpha still contributes

The alpha is an executable behavior reference for Canvas interactions, semantic invariants, capture compensation, iframe lifecycle, input relay, comment anchors, and review states. Tests may be rewritten from observed behavior.

The alpha is not a schema, API, package, storage, identity, or migration constraint. The stable v1 ships no old document codec, IndexedDB Canvas repository, whole-document repository facade, URL Frame identity, Git-derived remote authority, or compatibility cutover.

## Why the rewrite is still phased

A clean rewrite does not mean one undifferentiated implementation jump. The phases follow dependency order and end with executable proofs:

1. Domain and protocol.
2. Local authority and replica.
3. Local daemon and CLI.
4. Representations and bridge.
5. Review UI.
6. Cloudflare platform.
7. Synchronization.
8. OAuth MCP.
9. Installation and release.

This sequence protects correctness without preserving the old architecture.

## Rejected approaches

- A compatibility façade around `CanvasSession` or `CanvasRepository`.
- Importing alpha Canvas data into the shared ledger.
- A new IndexedDB synchronization layer.
- URL identity with environment-specific overrides.
- D1 as the canonical Canvas ledger.
- A Queue in the commit path.
- Whole-Canvas CRDTs for v1.
- Cloudflare bindings or Code Mode SDK types in domain packages.
- One MCP tool per Canvas command.
- Automatic localhost tunneling or a generic URL proxy.
- Organization tenancy inside one customer installation.
