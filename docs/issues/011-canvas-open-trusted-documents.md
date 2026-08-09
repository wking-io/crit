# Let the Canvas core open trusted documents

**Strength:** Strong · **Dependency category:** in-process

## Files

- `src/core/canvas.ts` — `Canvas.open(input: unknown)`
- `src/runtime/crit-runtime.ts:44-60` — `malformedDetail` + `openStoredCanvas`
- `src/runtime/snapshot-service.ts:56-68`
- `src/session/canvas-session.ts:93-120` — `openFailureDetail` + `openCanvas`
- `src/runtime/internal/document-codec.ts:9-22`
- `src/node/file-system-canvas-repository.ts:158-170`

## Problem

`Canvas.open(input: unknown)` fails with `CanvasOpenFailed |
CanvasDocumentTooLarge`, so every caller that re-opens an *already-validated*
`CanvasDocument` must map errors that cannot occur on that call path — and the
"document too large" detail string (`Canvas Document is N bytes; maximum is M`)
is re-rendered in five files. The interface forces callers to handle
impossible error modes; the knowledge that they're impossible is re-encoded as
boilerplate at each call site.

## Proposed deepening

Add a core operation for decoded documents — `Canvas.fromDocument(document:
CanvasDocument): Canvas` — where an invariant violation is a defect (the
document was supposed to be valid). Keep `Canvas.open(unknown)` for true edges
(file bytes, HTTP bodies). Move the failure-detail rendering into the core as
the one place that knows how to describe its own failures.

Five call sites lose their error-mapping blocks; downstream signatures shed
impossible error union members.

## Origin

Architecture review, candidate 2 (first step of issue 010), 2026-08-09.
