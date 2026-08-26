# Phase 8: Hosted review

## Outcome

Let a teammate review a shared Canvas in the deployed UI. They sign in with company Access. They do not install Crit.

## Build

- Serve the same review UI from the Worker and Workers Static Assets.
- Authenticate reviewers with Cloudflare Access and authorize them with Workspace policy.
- Let a reviewer view Frames and set review status through the remote Canvas Authority.
- Resolve shared Representations to registered preview Deployments or artifacts. The hosted UI assigns iframe src to that preview origin. Do not proxy the preview. Do not require localhost or `crit dev` on the reviewer machine.
- Do not publish an MCP endpoint, Code Mode runtime, or Crit OAuth agent grant.

## Prove

- A Person with no local Crit install opens a shared Canvas in the browser, signs in, and reviews Frames. The live Frame loads the registered preview inside the hosted UI iframe.
- When that preview is Access-gated, the Access login appears in the Frame after `allow_iframe`. Cloudflare-account IdP sign-in happens top-level once. Then the Frame reuses `CF_Authorization`.
- Workspace policy admits members and rejects everyone else at every API boundary.
- The author's local replica receives the reviewer's accepted changes.
- Requests to `/mcp` and to any agent OAuth route fail as unknown.
