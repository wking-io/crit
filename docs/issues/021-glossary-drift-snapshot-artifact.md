# Glossary drift: `FrameSnapshot` vs "Snapshot Artifact"

**Severity:** Low · **Area:** naming / ubiquitous language

## Problem

CONTEXT.md names the concept **Snapshot Artifact**, but the core schema calls
it `FrameSnapshot` (`src/core/canvas-command.ts:46`), and
`src/runtime/snapshot-archive.ts:14` re-aliases it back
(`export type SnapshotArtifact = FrameSnapshot`) — two names for one glossary
term, with the alias existing only to reconcile them.

Smaller instance: the repository adapter names its `load` implementation
`read` (`src/node/file-system-canvas-repository.ts:39`).

## Proposed fix

Rename the schema to `SnapshotArtifact` in the core, drop the alias, and align
the adapter method name with its interface (`load`). Mechanical rename; the
document format on disk is unaffected (field name `snapshot` on frames stays).

## Origin

Standards review (ubiquitous-language drift) of the 2026-08-09 review.
