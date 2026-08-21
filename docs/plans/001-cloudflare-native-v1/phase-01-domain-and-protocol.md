# Phase 1: Target domain and protocol

## Outcome

Create the new domain and wire contracts without importing alpha types or storage.

## Build

- Define branded IDs, Person and Agent Actors, Principals, trusted attribution, Canvas Projection, semantic commands, Representations, changes, cursors, conflicts, and receipts.
- Implement the pure `CanvasEngine` and projection replay.
- Version every persisted and wire schema from its first use.
- Keep commands unauthored. Trusted boundaries add identity, time, order, and authorization context.
- Establish the target package graph and forbid adapter imports into domain packages.

## Prove

- Atomic batches either apply completely or leave the projection unchanged.
- Stable fixtures replay deterministically.
- Duplicate IDs, invalid geometry, bad anchors, and stale content preconditions fail with typed errors.
- Protocol fixtures round-trip in every supported runtime.
- Dependency checks show that domain and protocol packages have no platform imports.
