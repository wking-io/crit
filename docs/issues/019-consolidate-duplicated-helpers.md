# Consolidate duplicated small helpers

**Severity:** Low · **Area:** cross-cutting

## Findings

Duplications *not* already covered by the architecture issues (010-017):

- `PositiveDimension` defined twice: `src/core/canvas.ts:13` and
  `src/core/canvas-command.ts:101`.
- `isNodeError` defined twice: `src/node/file-system-snapshot-archive.ts:624`
  and `src/node/file-system-agent-activity.ts:125`.
- Four identical 405/400 response blocks in the Vite middleware
  (`src/vite/index.ts:461-543`) and twin watcher notifiers (`:379-417`) — the
  route-table extraction (issue 015) removes most of these; whatever remains
  should share one helper.
- The "document too large" detail string built in six places — resolved by
  issue 011.

## Proposed fix

One definition each, imported where needed. `document-codec.ts` already exists
as a home for the shared open/error mapping until issue 011 lands.

## Origin

Standards review (Duplicated Code) of the 2026-08-09 architecture and code
review.
