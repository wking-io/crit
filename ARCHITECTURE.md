# Architecture

Crit is a local-first collaborative review canvas for live web applications. Authors use the Crit UI, CLI, and local agents to arrange and review Frames. After share, teammates review in the hosted UI. They do not install Crit. Agents do not operate on the shared installation. v1 is Frames only.

The target v1 is a clean rewrite. The current local-only alpha remains a behavior reference during the rewrite. Its persistence, identity, URL, and adapter interfaces do not constrain the new system.

## Product boundary

Crit runs in two places:

- `crit dev` provides complete local authoring, local agents, SQLite persistence, and local artifacts.
- A customer-hosted Cloudflare deployment provides company identity, team sharing, canonical ordering, shared live Representations, and the hosted review UI.

A developer can work without an account or network connection. Linking a Canvas adds synchronization. It does not replace local authoring.

One Cloudflare installation is one tenant. Crit has no Organization model in v1. A Workspace is the collaboration and authorization boundary inside an installation.

## Package ownership

```text
packages/
├── domain/           CanvasEngine, commands, projection, identity, Representations
├── protocol/         accepted changes, cursors, sync, bridge, and errors
├── authority/        CanvasAuthority and its conformance suite
├── replica/          CanvasReplica, pending work, rebase, and conflicts
├── representations/  RepresentationRuntime and RenderPlan
├── client/           HTTP and WebSocket clients
├── react/            primary review UI
├── host/             browser composition root (depends on react + client)
├── frame-bridge/     versioned browser bridge
├── local/            crit dev, SQLite, and filesystem artifacts
├── cloudflare/       Worker, Durable Object, D1, R2, Access, and hosted UI
└── cli/              local, sync, and deployment commands
```

These boundaries are part of the rewrite contract. The old source tree is not migrated package by package.

## Canvas domain

`CanvasEngine` is the platform-neutral authority for Canvas rules. It accepts unauthored semantic commands and returns an atomic transition. It has no dependency on React, storage, transport, or Cloudflare.

A Canvas projection contains:

- Frames and their geometry, viewport, review state, and Representation.
- Stable entity IDs and deletion records required for replay.

A projection is a rebuildable view. It is not the canonical stored record.

Commands express intent. They never contain trusted Actor identity, acceptance time, server sequence, or Workspace authority. Narrow semantic preconditions protect conflicting text and destructive edits. Unrelated changes can serialize without conflict.

## Canonical Canvas ledger

Every Canvas authority stores one ordered stream of accepted semantic changes. Each accepted change contains:

- A globally unique `changeId`.
- The Canvas ID.
- The remote cursor the author had observed.
- The semantic command batch.
- One server-assigned sequence and opaque cursor.
- Server-stamped Person or Agent attribution.
- The acceptance time.
- A request digest and authorization subject for retry validation.

The authority returns the original receipt for an identical retry. It rejects reuse of the same `changeId` with different commands, observed cursor, or authorization subject.

The observed cursor is not an exact commit precondition. Commands carry exact content preconditions where needed. This permits independent offline work to survive intervening remote changes.

## Local authority and replica

`crit dev` is the only local state owner. The local Crit UI, CLI, Vite adapter, and local agents connect to it. The daemon owns:

- A local SQLite Canvas authority.
- The durable local replica state.
- Local artifact files.
- HTTP and WebSocket endpoints.
- Remote authentication and synchronization.

`CanvasReplica` hides optimistic projection, pending intent, local dependency order, remote cursors, retry, rebase, and recoverable conflicts. Local changes update the projection immediately and survive process restarts.

The daemon binds only to loopback or a user-owned Unix socket. Integrated development servers proxy Crit requests and add the daemon credential server-side. The standalone UI uses a short-lived one-time bootstrap to receive a restricted HttpOnly cookie.

## Synchronization

A linked replica pushes pending changes by stable `changeId` and pulls accepted changes after its acknowledged cursor. The replica applies accepted remote changes, then replays pending local changes in local dependency order.

WebSockets are notification channels. They never establish correctness. A cursor pull repairs missed, duplicated, or reordered notifications.

The first share uses stable share and import IDs. The remote authority stores one receipt that binds the local projection digest to the new remote Canvas, Workspace, and importing Person. A retry returns that receipt. A mismatched retry fails.

The remote ledger begins with the authenticated import. Crit does not label unverified Git identity or offline runtime metadata as server-verified history.

## People, Agents, and attribution

A Principal is the authenticated request identity. An Actor is the durable author of accepted work.

People work locally without an Access address and authenticate remotely through Cloudflare Access. Agents authenticate only through the local daemon on a developer's machine. There is no remote Agent principal.

Human attribution records the Person who acted. Agent attribution records:

- The durable Agent Actor.
- The Person who ran the local Agent.
- The execution ID.
- Optional client-reported harness, model, session, and task metadata.

The server stamps verified attribution. Client-reported runtime metadata remains visibly separate. Crit stores no private reasoning trace.

Canvas creation records `createdBy` as provenance. Creation grants no permanent authority. Workspace policy controls access.

## Workspaces

Workspace remains in the data model as the authorization boundary inside an Installation. v1 uses one implicit default Workspace. It does not expose Workspaces, ship workspace commands, or write workspace-switching product.

## Representations

A Frame points to a logical `RepresentationRef`:

- `application-route` identifies an Application, route, and optional serializable page state.
- `web-url` identifies an explicit external URL.
- `artifact` identifies immutable content by artifact ID and digest.

`RepresentationRuntime` resolves a reference for the current viewer. It returns an iframe plan, an artifact plan, or an unavailable state.

An `application-route` can resolve to localhost for an author and a registered preview Deployment for a teammate. Canvas state never stores machine bindings, deployment URLs, credentials, or iframe policy.

Local bindings belong to project and machine configuration. Shared Applications and Deployments belong to the Cloudflare control plane. Artifact bytes live in the local filesystem or R2.

## Frame Bridge

The framework-neutral Frame Bridge provides a versioned browser protocol for input relay, element anchors, route and revision reporting, anchor health, highlighting, and authorized inspection.

The bridge activation matrix is closed:

| Deployment mode | Bridge |
|---|---|
| Local development | On |
| Ordinary production build | Off |
| Ordinary production preview | Off |
| Explicit shared review preview | On |

The build requires an exact positive opt-in for a shared review preview. A missing or malformed flag remains off.

## Cloudflare deployment

The shared runtime uses:

- One Worker deployment for the API, hosted review UI, and Workers Static Assets.
- Cloudflare Access for company identity.
- D1 for installation settings, Workspaces, memberships, Teams, Applications, Deployments, and the Canvas directory.
- One SQLite Durable Object per Canvas for canonical changes, the projection, and hibernating WebSockets.
- R2 for immutable artifacts.

D1 never stores canonical Canvas content. Queues never participate in Canvas ordering. A Queue is added only with a concrete idempotent background job.

Each Canvas Durable Object performs one local SQLite transaction per accepted change. The transaction checks retry identity, applies the command batch, assigns a sequence, stores the change, and updates the projection. It performs no external I/O.

The hosted review UI talks to the Worker and Canvas Durable Object directly. A reviewer has no local replica and does not run `crit dev`.

## Explicit v1 exclusions

Crit v1 has no whole-Canvas CRDT, cross-Canvas transaction, automatic localhost tunnel, unrestricted URL proxy, multi-Organization tenancy, MCP server, Code Mode runtime, or OAuth agent grant. Git and document diffs are not synchronization protocols.

## Verification

The rewrite keeps the old alpha runnable only as a behavior reference. New code does not read or write old runtime state.

Shared conformance suites test the local SQLite authority and the Canvas Durable Object. End-to-end verification uses two offline replicas, one Cloudflare deployment, one shared preview, and one hosted-review browser session with no local Crit install.

The implementation plan lives in [`docs/plans/001-cloudflare-native-v1`](docs/plans/001-cloudflare-native-v1/overview.md).
