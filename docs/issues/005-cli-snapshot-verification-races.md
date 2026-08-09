# `crit snapshot` verifies via `frames.at(-1)` and races concurrent writers

**Severity:** Low · **Area:** CLI (`src/cli/command.ts`)

## Problem

After a successful capture, the CLI asserts the archived Frame is the *last*
frame in the returned document and that its provenance points at the source
Frame (`src/cli/command.ts:449-457` in the pre-review numbering). A concurrent
writer appending a Frame between the snapshot commit and the CLI's read makes a
**successful** capture report failure to the agent.

## Proposed fix

`SnapshotService.snapshotFrame` already knows the archived Frame's ID
(`snapshot-${artifact.artifactId}`). Find the archived Frame by provenance
`sourceId === frame` (or return the archived Frame ID from the service) instead
of positional `at(-1)`.

## Origin

Standards review (correctness B5) of the 2026-08-09 architecture and code
review.
