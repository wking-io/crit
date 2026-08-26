# Resolved product decisions

[Back to the overview](overview.md)

This file records the product decisions supplied in the active architecture conversation. It separates those inputs from design conclusions in the plan.

- The Canvas ledger is canonical.
- Crit remains complete for local authoring and review. Sharing adds a deployed team authority. It does not replace local work.
- Authors build canvases locally. Agents author only through local tools on a developer's machine.
- The UI is the primary viewing and review interface. Agents are first-class authors of Frames.
- After share, review is human-led. Teammates open the hosted UI through Cloudflare Access. They do not install Crit.
- `crit login` reconciles the local Person with the Access-authenticated Person. Share and later sync use that bound Person. The bind is login. It is not an email match at share time.
- Crit has no remote agent interface, MCP server, Code Mode runtime, or OAuth agent grants.
- One customer-hosted installation is one tenant. The v1 model has no Organization.
- Workspace stays in the data model as the authorization boundary. v1 does not expose Workspaces, ship workspace commands, or write workspace-switching product.
- Authors add Frames through the CLI or local agents. The review UI does not add Frames.
- A Frame's Representation is set when the Frame is created. There is no generic representation-change action. The only later content action is snapshot, which creates a new artifact Frame from a live Frame.
- Contextual help and keyboard shortcuts use TanStack Hotkeys.
- Frames refer to logical live-page Representations. Local and shared environments may resolve the same Frame differently.
- The Frame Bridge has an installation skill and stays off by default in production environments.
- Unselected Frames are not interactive. A capture overlay sits on top so canvas pan, zoom, and select hit Crit. The sole selected Frame is native-interactive.
- The host sets a live Frame URL by assigning iframe src. The page reports route changes. Frame Bridge has no session, highlight, inspect, or capability set.
- Hosted review iframes the registered preview origin. Crit does not proxy that origin.
- Shared-review-preview responses send `frame-ancestors` for the Crit host as an HTTP header. Ordinary production does not name the Crit host. Browsers ignore `frame-ancestors` in a meta tag.
- Access on the Crit Installation authenticates reviewers. Access on a customer preview is optional and independent. If the preview is Access-gated, that Access app needs `allow_iframe` and SameSite None so the login page can sit in the Frame.
- The Cloudflare account IdP at `dash.cloudflare.com` sends `X-Frame-Options: SAMEORIGIN`. First sign-in for that IdP happens top-level. Then `CF_Authorization` is SameSite None and the Frame reuses it.
- Wrangler OAuth cannot edit Access apps. Preview Access setup uses an Account API token with Access: Apps and Policies Edit.
- Turnstile, Bot Fight, Under Attack, or a blocking `X-Frame-Options` on the preview hostname keeps the preview out of the Frame.
- The shared runtime is Cloudflare-native.
- Agent changes identify the Agent as author. Provenance also records the local Person who ran the Agent and useful harness, model, session, and execution metadata when available.
- Stable v1 is a full rewrite. Preserving alpha APIs, storage formats, and runtime compatibility is not a goal.
- The alpha remains only an executable behavior reference. New code does not read or write alpha Canvas state.
- Frame display mode (`viewport` vs `fit-page`) is not a v1 command.
- The rewrite ports the alpha product extras: align and distribute, breakpoint presets, contextual help, pause-offscreen Frames, fullscreen, open in new tab, and developer copy-node-id. It does not port undo and redo.
- Notes and Comments are out of v1. The rewrite does not keep the old domain model for later reuse. They come back only after a first-principles design.

Items not decided directly by the user, including Durable Object partitioning, first-share import semantics, protocol fields, and phase order, are architecture choices documented in `overview.md` and `synthesis.md`.

The earlier input that shared agents would connect through an OAuth Code Mode MCP is withdrawn. See [ADR 0001](../../adr/0001-hosted-review-no-mcp.md).
