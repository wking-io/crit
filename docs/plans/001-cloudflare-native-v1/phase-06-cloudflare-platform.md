# Phase 6: Cloudflare authority and control plane

## Outcome

Deploy the shared human collaboration surface entirely in a customer Cloudflare account.

## Build

- Serve API routes and the UI through one Worker deployment and Workers Static Assets.
- Use Cloudflare Access for company identity and Crit policy for Workspace authorization.
- Store Installation, default Workspace, memberships, Teams, Applications, Deployments, and Canvas directory entries in D1.
- Implement one SQLite Durable Object per Canvas using the same `CanvasAuthority` contract.
- Store immutable artifacts in R2.
- Serve the hosted review UI from the same Worker. Do not publish MCP or agent OAuth routes.
- Use hibernating WebSockets only for notifications.

## Prove

- Authority conformance passes unchanged against the Durable Object.
- Eviction, restart, retry, and concurrent submission preserve ordering and projection.
- The first Workspace becomes default atomically and selection follows the documented order.
- Cross-Workspace access fails at every API boundary.
- D1 contains no canonical Canvas content and no Queue participates in commits.
