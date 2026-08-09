# Extract drag/resize/attach interaction rules from pointer handlers

**Strength:** Worth exploring · **Dependency category:** in-process

## Files

- `src/react/canvas-viewport.tsx:704-774` — `startMove`
- `src/react/canvas-viewport.tsx:776-846` — `startResize`

## Problem

Review-domain decisions are interleaved with `window.addEventListener`
plumbing: attached Notes previewed by frame delta, the drop rule "Note center
inside a Frame's bounds → attach, outside → detach", and resize emitting a
move+resize+heightMode-reset command batch. Two problems:

1. No locality — these rules are untestable without simulating pointer capture,
   and have no tests.
2. A leak across the core seam — `Canvas.apply` already owns "attached Notes
   move with their Frame" (`canvas.ts:632-643`), and the preview re-implements
   the same semantics in the UI. If the core's attachment behavior changes,
   the preview silently diverges.

## Proposed deepening

An interaction module with the interface "(start geometry, pointer delta,
document) → preview geometries" and "(final geometry, document) → command
batch". The component keeps only listener registration and `setPreview`. The
module can even compute previews by applying commands to a scratch Canvas,
eliminating the duplication with the core outright.

## Origin

Architecture review, candidate 7, 2026-08-09.
