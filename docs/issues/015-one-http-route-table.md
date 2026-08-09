# One route table for the Crit HTTP interface

**Strength:** Worth exploring · **Dependency category:** in-process

## Files

- `src/http/contract.ts` — `isCritHttpRequest`, `canvasRouteFrom`
- `src/vite/index.ts:115-158` — `requestedCanvasId`, `requestedSnapshotId`, `requestedEditorCanvasId`; middleware at `:456+`

## Problem

The Canvas URL space is parsed three times by separate parsers that must agree
on prefix stripping and `decodeURIComponent` behavior: `canvasRouteFrom` inside
the HTTP handler, `isCritHttpRequest` as a pre-filter, and the Vite plugin's
own `requestedCanvasId` — the last exists only so the plugin can trigger
manifest reconciliation before handing the request to the handler that parses
the URL again. The middleware also repeats the 405/400 error envelope four
times. Routing knowledge that belongs to the contract has leaked into its host
adapter.

## Proposed deepening

Make route parsing part of the contract's interface: parse once, expose the
parsed route (canvas id / frame snapshot / activity), and let the plugin
consume the parsed route for manifest sync instead of re-deriving it.
Concentrate the method-guard/error-envelope helper in the contract. Routing
then gets direct unit tests instead of being reachable only through a full
Vite dev-server integration test.

## Origin

Architecture review, candidate 6, 2026-08-09.
