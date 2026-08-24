---
name: crit-identity
description: Diagnoses Crit identity for local provenance or remote company authentication. Use when Crit reports missing local identity or Access login failure.
---

# Crit identity

First identify the boundary that failed.

## Local provenance

Local-only work may use repository Git name and email as provisional provenance. It is optional and does not grant Workspace access or become verified remote history.

1. Inspect effective repository values with `git config --get user.name` and `git config --get user.email`.
2. If a value is missing, ask the user. Do not infer identity from history, remotes, or hosting accounts.
3. With confirmation, set only repository-local values.
4. Re-run the Crit identity diagnostic.

## Remote person identity

Cloudflare Access establishes the company account. Crit maps that verified identity to a Person and applies Workspace policy.

- Do not repair remote identity by changing Git configuration.
- Verify the Installation hostname, Access session, Person mapping, and Workspace membership.
- If the Person has several Workspaces, Crit selects the remembered accessible Workspace, then the default, then the only or earliest accessible Workspace.

## Local Agent identity

An Agent runs only through the local daemon. Crit records the Agent as author and the Person who ran it as the Delegating Person.

- Treat harness, model, session, and task fields as reported runtime metadata, not proof of identity.
- There is no remote Agent identity, MCP grant, or Crit OAuth client to repair.
