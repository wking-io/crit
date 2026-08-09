# Snapshot capture has no overall deadline

**Severity:** Medium · **Area:** Snapshot Archive (`src/node/file-system-snapshot-archive.ts`)

## Problem

`FETCH_TIMEOUT_MS` (60 s) is applied per resource fetch via
`AbortSignal.timeout` (`file-system-snapshot-archive.ts:22,162`), and each fetch
is retried once with a 250 ms pause (`:141-150`). A page with many
sub-resources can keep a capture running for many minutes with no whole-capture
deadline; nothing bounds the total time of `SnapshotArchive.capture`.

README originally claimed the limit applied to "capture requests"; the wording
was corrected to "each resource fetch" in the review PR, but an overall
deadline is the behavior users likely expect, and the CLI's activity pulse for
capture assumes ~120 s (`src/cli/command.ts:447`).

## Proposed fix

Wrap the whole capture (`Effect` timeout around `archive.capture`, or a
deadline threaded into the resource fetcher) with a total budget — e.g. 60 s —
and restore the original README wording once true. Fail with the existing
`SnapshotCaptureFailed` carrying a "capture deadline exceeded" detail.

## Origin

Standards review (documented-standard violation A2) and Spec review
("Missing/Partial") of the 2026-08-09 architecture and code review.
