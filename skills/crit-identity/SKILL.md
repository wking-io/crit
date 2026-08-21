---
name: crit-identity
description: Diagnoses Crit identity for local provenance or remote company authentication. Use when Crit reports missing local identity, Access login failure, or OAuth identity mismatch.
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

## Remote Agent identity

An Agent uses Crit OAuth. Its grant records the delegating Person, OAuth client, Workspace, scopes, and stable Agent Actor.

- Reauthorize expired or revoked grants through Crit.
- Do not copy bearer tokens into configuration, comments, or commands.
- Treat harness, model, session, and task fields as reported runtime metadata, not proof of identity.
