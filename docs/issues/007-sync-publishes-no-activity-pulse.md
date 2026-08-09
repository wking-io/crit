# `crit sync` publishes no agent-activity pulse

**Severity:** Low · **Area:** CLI / discovery (`src/cli/command.ts`, `src/discovery/crit-manifest.ts`)

## Problem

README: "CLI commands that work on a Canvas automatically publish a short local
activity pulse." `apply`, `create`, `add`, `open`, and `snapshot` call
`pulseAgentActivity`, but `sync` — which creates and mutates Canvases — never
does (`src/cli/command.ts`, `syncCommand`). Agent-driven manifest syncs are
invisible to open editors until the normal 2 s poll.

## Proposed fix

Pulse activity for each Canvas the sync touches (the sync result already lists
the affected Canvas IDs and their added/updated Frame IDs). Detail string:
"Syncing manifest".

## Origin

Spec review ("Missing/Partial") of the 2026-08-09 architecture and code review.
