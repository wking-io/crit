# Issue backlog

Findings from the 2026-08-09 architecture and code review (reviewed at commit
`f4509f0`), one file per issue, ordered by suggested priority. Each file is
self-contained and can be pasted into a GitHub issue as-is.

Already fixed by the review PR (no issue filed): stale input-bridge sentence in
ARCHITECTURE.md, `AddSnapshotFrame` reachable from the public apply surface,
unsandboxed archived-Frame iframes, missing cross-origin check on mutating HTTP
routes, snapshot capture storing Vite's CSS-as-JS shim, and the `AddNote`
width/height contradiction in `skills/crit/SKILL.md`.

## Correctness and robustness

| # | Issue | Severity |
|---|-------|----------|
| 001 | [Stale Canvas lock permanently wedges writes](001-stale-canvas-lock-wedges-writes.md) | High |
| 002 | [Live-refresh hint channel is dead in the served editor](002-served-editor-never-gets-file-watch-refresh.md) | High |
| 003 | [Snapshot capture has no overall deadline](003-snapshot-capture-has-no-overall-deadline.md) | Medium |
| 004 | [Rejected snapshot commits orphan artifacts on disk](004-rejected-snapshots-orphan-artifacts.md) | Medium |
| 005 | [`crit snapshot` verifies via `frames.at(-1)` and races concurrent writers](005-cli-snapshot-verification-races.md) | Low |
| 006 | [HTTP 413 vs 400 routed by error-message text](006-http-413-routed-by-message-text.md) | Low |
| 007 | [`crit sync` publishes no agent-activity pulse](007-sync-publishes-no-activity-pulse.md) | Low |
| 008 | [Agent-activity files are never removed from disk](008-activity-files-never-removed.md) | Low |
| 009 | [Snapshot HTML is not minified though README says it is](009-snapshot-html-not-minified.md) | Low |

## Architecture (deepening opportunities)

| # | Issue | Strength |
|---|-------|----------|
| 010 | [One failure vocabulary for the durable Canvas path](010-one-failure-vocabulary.md) | Strong |
| 011 | [Let the Canvas core open trusted documents](011-canvas-open-trusted-documents.md) | Strong |
| 012 | [One deep camera module](012-one-deep-camera-module.md) | Strong |
| 013 | [A single Frame input relay module](013-single-frame-input-relay.md) | Worth exploring |
| 014 | [Fold or retire `CritRuntime` (single-adapter seam)](014-fold-or-retire-critruntime.md) | Worth exploring |
| 015 | [One route table for the Crit HTTP interface](015-one-http-route-table.md) | Worth exploring |
| 016 | [Extract drag/resize/attach interaction rules](016-extract-interaction-rules.md) | Worth exploring |
| 017 | [Split `canvas-viewport.tsx`](017-split-canvas-viewport.md) | Worth exploring |

## Code health and documentation

| # | Issue |
|---|-------|
| 018 | [Remove dead code and speculative generality](018-dead-code-cleanup.md) |
| 019 | [Consolidate duplicated small helpers](019-consolidate-duplicated-helpers.md) |
| 020 | [React tests assert implementation constants, not behavior](020-react-tests-assert-constants.md) |
| 021 | [Glossary drift: `FrameSnapshot` vs "Snapshot Artifact"](021-glossary-drift-snapshot-artifact.md) |
| 022 | [Document or trim the undocumented public surface](022-document-or-trim-undocumented-surface.md) |
