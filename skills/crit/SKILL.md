---
name: crit
description: Uses Crit to create and review Canvases and Frames through the local crit dev client. Use when the user asks an Agent to inspect or change Crit authoring work on their machine.
---

# Crit workflows

## Rewrite status

This skill describes the stable v1 contract. Before running a command, check `crit --help`. The current alpha does not implement the target workflow. Do not guess commands, edit alpha Canvas files, or treat alpha output as the v1 protocol.

## Choose the surface

- Use the local client exposed by `crit dev` while the user is authoring on their machine.
- After a Canvas is shared, people review in the hosted UI. They do not install Crit. Do not review a shared Canvas as an Agent.
- Use the UI as the primary viewing and review surface. Use Agent operations for structured local edits.

## Work safely

1. Discover the Canvas and its current projection.
2. Reuse stable entity IDs. Do not remove and recreate an entity to change a property.
3. Submit related semantic commands as one atomic change.
4. Use narrow expected-content preconditions for edits that can conflict.
5. Preserve unresolved local work. Report recoverable conflicts instead of discarding them.
6. Use `applicationRoute` for a project page, `webUrl` for an intentional external URL, and `artifact` for immutable captured content.
7. Use `ready-for-review` when work awaits assessment. Use `approved` only after that assessment.
8. Ask before deleting or replacing another Actor's review content.

## Agent attribution

Local Agent access comes from the daemon on the user's machine. Crit records the Agent as author and separately records the Person who ran it. Supply harness, model, session, and task metadata when the client supports it, but never claim that client-reported metadata is server-verified.

Do not send credentials, tokens, private reasoning, or storage bindings in Canvas commands.

## Preview CI

Use `skills/crit-register-deployment/SKILL.md` when GitHub Actions should register a preview origin after deploy.

## Cloudflare installation

Use `skills/install-crit-cloudflare/SKILL.md` when the user wants to deploy Crit in a Cloudflare account. Access is optional. Without Access, each visitor gets their own anonymous person for hosted work.

## Workspaces

Workspace exists in the data model. v1 does not expose it. Do not offer workspace commands or ask the user to switch Workspaces.

## Presence and history

Presence is ephemeral and never proves authorship. Accepted Canvas Changes and their trusted attribution are the durable record. Use the Crit interfaces rather than editing SQLite, D1, Durable Object, R2, or artifact files directly.

## Setup failures

If the local client is unavailable, ask the user to start the project's `crit dev` integration or follow the target setup documentation. If a teammate needs to review a shared Canvas, give them the hosted review URL. Git identity is not remote authentication.
