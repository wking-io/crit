---
name: crit
description: Uses Crit to create and review Canvases, Frames, Notes, and comments locally or through the shared OAuth MCP service. Use when the user asks an Agent to inspect or change Crit review work.
---

# Crit workflows

## Rewrite status

This skill describes the stable v1 contract. Before running a command, check `crit --help` or the MCP operation catalog. The current alpha does not implement the target workflow. Do not guess commands, edit alpha Canvas files, or treat alpha output as the v1 protocol.

## Choose the surface

- Use the local client exposed by `crit dev` for work on the developer's machine.
- Use the OAuth MCP endpoint for shared work. It exposes only `search` and `execute`.
- Use the UI as the primary viewing and review surface. Use Agent operations for structured edits.

## Work safely

1. Discover the Canvas and its current projection.
2. Reuse stable entity IDs. Do not remove and recreate an entity to change a property.
3. Submit related semantic commands as one atomic change.
4. Use narrow expected-content preconditions for edits that can conflict.
5. Preserve unresolved local work. Report recoverable conflicts instead of discarding them.
6. Use `application-route` for a project page, `web-url` for an intentional external URL, and `artifact` for immutable captured content.
7. Use `ready-for-review` when work awaits assessment. Use `approved` only after that assessment.
8. Ask before deleting or replacing another Actor's review content.

## Agent attribution

Remote access comes from an OAuth grant scoped to an Installation and Workspace. Crit records the Agent as author and separately records the Person who delegated access. Supply harness, model, session, and task metadata when the client supports it, but never claim that client-reported metadata is server-verified.

Do not send credentials, tokens, private reasoning, or storage bindings in Canvas commands or comments.

## Workspaces

Crit automatically selects an accessible Workspace. Use Workspace commands only when the user asks to switch. Switching affects future links and browsing; it does not move an already linked Canvas.

## Presence and history

Presence is ephemeral and never proves authorship. Accepted Canvas Changes and their trusted attribution are the durable record. Use the Crit interfaces rather than editing SQLite, D1, Durable Object, R2, or artifact files directly.

## Setup failures

If the local client is unavailable, ask the user to start the project's `crit dev` integration or follow the target setup documentation. If remote authorization fails, complete OAuth through the Crit server. Git identity is not remote authentication.
