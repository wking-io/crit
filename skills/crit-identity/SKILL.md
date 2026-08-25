---
name: crit-identity
description: Diagnoses Crit identity for local provenance or remote company authentication. Use when Crit reports missing local identity or Access login failure.
---

# Crit identity

First identify the boundary that failed.

## Local provenance

Local-only work records a Person with unspecified email. Cloudflare Access supplies the company address later. Git name and email do not become the Person record and do not grant Workspace access.

1. If Crit is missing a local Person, first boot writes unspecified email. Do not invent an address.
2. Do not repair local identity by changing Git configuration.
3. Hosted review maps Access claims to Person email.

## Remote person identity

Cloudflare Access establishes the company account. Crit maps that verified identity to a Person and applies Workspace policy.

- Do not repair remote identity by changing Git configuration.
- Verify the Installation hostname, Access session, Person mapping, and membership on the implicit default Workspace.
- v1 does not expose workspace switching. Do not offer Workspace commands.

## Local Agent identity

An Agent runs only through the local daemon. Crit records the Agent as author and the Person who ran it as the Delegating Person.

- Treat harness, model, session, and task fields as reported runtime metadata, not proof of identity.
- There is no remote Agent identity, MCP grant, or Crit OAuth client to repair.
