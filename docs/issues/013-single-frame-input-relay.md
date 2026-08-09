# A single Frame input relay module

**Strength:** Worth exploring (high value, invasive in the most-churned file) · **Dependency category:** in-process; the bridge seam already has two adapters

## Files

- `src/react/canvas-viewport.tsx:647-689` — window `gesturestart/change/end` capture
- `src/react/canvas-viewport.tsx:1270-1464` — FrameCard same-origin iframe relay (~195-line `useEffect`)
- `src/frame-bridge/index.ts:75-153` — injected cross-origin script

## Problem

The intent-relay semantics — gesture scale bookkeeping, ctrl/meta wheel routing
via `wheelDestination`, and the "suppress wheel while a native gesture is
active" guard — exist in three coordinated copies across two execution
contexts. The guard alone appears at `canvas-viewport.tsx:637`,
`canvas-viewport.tsx:1284`, and `frame-bridge/index.ts:116`. A routing bug
needs three synchronized edits. Test coverage is a truth table for
`wheelDestination` only; the wiring where bugs live is untestable in its
current shape.

## Proposed deepening

Extract a Frame input module owning "DOM/bridge events in, canvas intents out"
(pan, zoom-impulse, select, tool, hotkey), with two adapters at the seam that
already exists: a same-origin DOM adapter and the postMessage bridge adapter.
FrameCard and the viewport subscribe to intents rather than owning listeners.
Tests feed synthetic events and assert emitted intents — no iframe needed.

## Origin

Architecture review, candidate 4, 2026-08-09.
