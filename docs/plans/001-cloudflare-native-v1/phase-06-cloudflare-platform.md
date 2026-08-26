# Phase 6: Cloudflare authority and control plane

## Outcome

Deploy the shared human collaboration surface entirely in a customer Cloudflare account.

## Build

- Serve API routes and the UI through one Worker deployment and Workers Static Assets.
- Use Cloudflare Access for company identity on the Crit Installation hostname and Crit policy for Workspace authorization. Access on a customer preview is optional. The Frame Bridge skill configures it when that preview is already gated.
- Store Installation, default Workspace, memberships, Teams, Applications, Deployments, and Canvas directory entries in D1.
- Implement one SQLite Durable Object per Canvas using the same `CanvasAuthority` contract.
- Store immutable artifacts in R2.
- Serve the hosted review UI from the same Worker. Do not publish MCP or agent OAuth routes.
- Use hibernating WebSockets only for notifications.

## Prove

- Authority conformance passes unchanged against the Durable Object.
- Eviction, restart, retry, and concurrent submission preserve ordering and projection.
- The Installation uses one implicit default Workspace. v1 does not expose workspace switching.
- Unauthorized access fails at every API boundary.
- D1 contains no canonical Canvas content and no Queue participates in commits.
