# Rejected snapshot commits orphan artifacts on disk

**Severity:** Medium · **Area:** Snapshot Service / Snapshot Archive (`src/runtime/snapshot-service.ts`)

## Problem

`SnapshotService.snapshotFrame` captures first, then commits the
`AddSnapshotFrame` command (`snapshot-service.ts:84-94`). If the commit is
rejected — most likely `snapshot-source-changed` because the live Frame's URL
changed during capture — the already-written artifact file under
`.crit/snapshots` (written at `file-system-snapshot-archive.ts:82-95`) is never
deleted. Orphans accumulate silently.

## Proposed fix

On command failure, delete the just-captured artifact (add a `remove(artifactId)`
operation to the `SnapshotArchive` interface, or scope the write so it only
links into place after the command commits). A periodic sweep is not needed —
the failure site knows exactly which artifact to clean up.

Add a test: force `snapshot-source-changed` (change the Frame URL between
capture and commit via the injected archive stub) and assert no artifact file
remains.

## Origin

Standards review (correctness B4) of the 2026-08-09 architecture and code
review.
