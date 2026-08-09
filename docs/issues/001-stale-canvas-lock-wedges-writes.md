# Stale Canvas lock permanently wedges writes

**Severity:** High · **Area:** Canvas Repository (`src/node/file-system-canvas-repository.ts`)

## Problem

`apply` acquires a per-Canvas lock by creating `<canvas>.json.lock` with `wx`
and spinning on `EEXIST` for at most 5 seconds (`file-system-canvas-repository.ts:134-155`).
Release only happens through the in-process `Effect.ensuring` cleanup (`:201`).
If a writer is killed between acquire and release (agent process killed,
browser host crash, power loss), the lock file stays on disk forever. After
that, **every** browser and agent write to that Canvas spins 5 s and fails.

The lock file records the owning PID (`:139-141`), but nothing ever reads it.

This contradicts README's promise: "Per-Canvas filesystem locks serialize local
writers … so unrelated agent and browser edits merge without manual revision
wiring."

## Proposed fix

Detect and steal stale locks: when acquisition times out, read the PID from the
lock file and check liveness (`process.kill(pid, 0)`); if the owner is dead —
or the lock's mtime exceeds a generous TTL — remove the lock and retry once.
Surface a clear error naming the lock path when the lock is genuinely held.

Add a test: create a lock file with a dead PID, assert `apply` still succeeds.

## Origin

Standards review (correctness B3) and Spec review ("Looks Wrong") of the
2026-08-09 architecture and code review.
