# Agent-activity files are never removed from disk

**Severity:** Low · **Area:** Agent Activity Store (`src/node/file-system-agent-activity.ts`)

## Problem

README: "Activity files under `.crit/activity` expire automatically." Only the
*signal* expires — `read` computes `active` from `activeUntil`
(`file-system-agent-activity.ts:60-65`) — but the JSON files themselves are
never deleted. A long-lived project accumulates one stale file per Canvas ever
touched by an agent.

Low impact (files are tiny and ignored), but it is a wording divergence from
the README and mild clutter in `.crit/`.

## Proposed fix

Either delete expired files opportunistically (on `signal`/`clear`/`read` of
the same Canvas), or adjust README wording to say the *signals* expire
automatically while files may persist.

## Origin

Spec review ("Looks Wrong", minor) of the 2026-08-09 architecture and code
review.
