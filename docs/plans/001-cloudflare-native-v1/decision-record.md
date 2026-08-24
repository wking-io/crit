# Resolved product decisions

[Back to the overview](overview.md)

This file records the product decisions supplied in the active architecture conversation. It separates those inputs from design conclusions in the plan.

- The Canvas ledger is canonical.
- Crit remains complete for local authoring and review. Sharing adds a deployed team authority. It does not replace local work.
- Authors build canvases locally. Agents author only through local tools on a developer's machine.
- The UI is the primary viewing and review interface.
- After share, review is human-led. Teammates open the hosted UI through Cloudflare Access. They do not install Crit.
- Crit has no remote agent interface, MCP server, Code Mode runtime, or OAuth agent grants.
- One customer-hosted installation is one tenant. The v1 model has no Organization.
- The first Workspace becomes the installation default. Login connects automatically. Workspace commands exist to switch.
- Frames refer to logical live-page Representations. Local and shared environments may resolve the same Frame differently.
- The Frame Bridge has an installation skill and stays off by default in production environments.
- The shared runtime is Cloudflare-native.
- Agent changes identify the Agent as author. Provenance also records the local Person who ran the Agent and useful harness, model, session, and execution metadata when available.
- Stable v1 is a full rewrite. Preserving alpha APIs, storage formats, and runtime compatibility is not a goal.
- The alpha remains only an executable behavior reference. New code does not read or write alpha Canvas state.

Items not decided directly by the user, including Durable Object partitioning, first-share import semantics, protocol fields, and phase order, are architecture choices documented in `overview.md` and `synthesis.md`.

The earlier input that shared agents would connect through an OAuth Code Mode MCP is withdrawn. See [ADR 0001](../../adr/0001-hosted-review-no-mcp.md).
