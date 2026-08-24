# Resolved product decisions

[Back to the overview](overview.md)

This file records the product decisions supplied in the active architecture conversation. It separates those inputs from design conclusions in the plan.

- The Canvas ledger is canonical.
- Crit remains complete for local authoring and review. Sharing adds a deployed team authority. It does not replace local work.
- The UI is the primary viewing and review interface. Agents are first-class authors of Frames, Notes, and comments.
- One customer-hosted installation is one tenant. The v1 model has no Organization.
- The first Workspace becomes the installation default. Login connects automatically. Workspace commands exist to switch.
- Frames refer to logical live-page Representations. Local and shared environments may resolve the same Frame differently.
- The Frame Bridge has an installation skill and stays off by default in production environments.
- The shared runtime is Cloudflare-native.
- Shared agents connect through one MCP server with OAuth against Crit.
- MCP uses Code Mode with `search` and `execute`.
- Agent changes identify the Agent as author. Provenance also records the delegating human account and useful harness, model, session, and execution metadata when available.
- Stable v1 is a full rewrite. Preserving alpha APIs, storage formats, and runtime compatibility is not a goal.
- The alpha remains only an executable behavior reference. New code does not read or write alpha Canvas state.
- Notes keep a closed color family. Color is a Canvas Command, not a client-only style.
- Notes and Comments store an Actor author on the Canvas Projection. Commands stay unauthored. The Canvas Engine stamps the author from the change's trusted Actor.
- Frame display mode (`viewport` vs `fit-page`) is not a v1 command.
- The rewrite ports the alpha product extras: align and distribute, breakpoint presets, contextual help, pause-offscreen Frames, fullscreen, open in new tab, and developer copy-node-id. It does not port undo and redo.

Items not decided directly by the user, including Durable Object partitioning, first-share import semantics, protocol fields, and phase order, are architecture choices documented in `overview.md` and `synthesis.md`.
