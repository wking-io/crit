---
name: crit-identity
description: Diagnoses Crit identity for local provenance or remote company authentication. Use when Crit reports missing local identity, Access login failure, or when implementing crit login Person reconcile.
---

# Crit identity

First identify the boundary that failed.

## Local provenance

Local-only work records a Person with unspecified email. Git name and email do not become the Person record and do not grant Workspace access.

1. If Crit is missing a local Person, first boot writes unspecified email. Do not invent an address.
2. Do not repair local identity by changing Git configuration.
3. Reconcile at `crit login`. That flow binds the local Person to the Access-authenticated Person.

## Login reconcile

`crit login` is the only join from local Person to company Person when Access is enabled.

1. Complete Access sign-in against the Installation hostname when Access protects that URL.
2. Map Access claims onto the existing local Person. Email becomes `{ _tag: "access", address }`.
3. Keep `personId` as the durable id.
4. Share and later sync use that bound Person.

When Access is not set up, `crit login` still records the Crit URL and binds the local Person to the anonymous person id returned by the installation. Share sends that id in `Crit-Person-Id`. Hosted review keeps the same id in a browser cookie.

Share does not invent a second join. Hosted reviewers sign in with Access on their own when Access exists.

## Remote person identity

Cloudflare Access establishes the company account. Crit maps that verified identity to a Person and applies Workspace policy.

- Do not repair remote identity by changing Git configuration.
- Verify the Installation hostname, Access session, Person mapping, and membership on the implicit default Workspace.
- v1 does not expose workspace switching. Do not offer Workspace commands.

## Local Agent identity

An Agent runs only through the local daemon. Crit records the Agent as author and the Person who ran it as the Delegating Person.

- Treat harness, model, session, and task fields as reported runtime metadata, not proof of identity.
- There is no remote Agent identity, MCP grant, or Crit OAuth client to repair.
