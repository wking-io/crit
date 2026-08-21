# Phase 3: Local daemon and developer setup

## Outcome

Make `crit dev` the single local state owner for the UI, CLI, and agents.

## Build

- Expose the replica through versioned local HTTP and WebSocket protocols.
- Bind to loopback or a user-owned Unix socket.
- Let integrated dev servers add daemon credentials server-side. Use one-time bootstrap and a restricted HttpOnly cookie for the standalone UI.
- Build `crit init`, `crit dev`, Canvas operations, status, and diagnostics against the new client.
- Generate manifest version 2 and install project-local Crit skills.
- Treat local identity as provisional provenance, never remote authority.

## Prove

- A fresh project installs, starts, creates a Canvas, edits it through UI and CLI, restarts, and retains all work.
- A browser page cannot call a neighboring user's daemon.
- UI, CLI, and a local Agent observe the same projection and pending state.
- No command reads alpha Canvas files or IndexedDB.
