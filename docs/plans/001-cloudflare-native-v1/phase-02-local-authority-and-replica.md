# Phase 2: Local authority and replica

## Outcome

Deliver crash-safe local authoring on the target ledger model.

## Build

- Implement `CanvasAuthority` first in memory, then in local SQLite.
- Store accepted changes, projection checkpoints, retry identity, and artifact references transactionally.
- Implement `CanvasReplica` with acknowledged cursor, accepted history, ordered pending changes, dependency edges, conflicts, and optimistic projection.
- Generate stable change IDs before local commit.
- Store artifact bytes outside SQLite and compensate when a capture commit fails.

## Prove

- Duplicate identical submissions return the original receipt; mismatched reuse fails.
- Concurrent submissions form one gap-free order.
- Restart recovers accepted and pending work without loss.
- Rebuilding from the ledger matches the checkpoint.
- Independent edits rebase and semantic conflicts remain recoverable.
