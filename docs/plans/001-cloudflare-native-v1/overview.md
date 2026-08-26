# Cloudflare-native collaborative Crit v1

## Decision

Crit v1 is a clean rewrite. We are optimizing for the best final system, not compatibility with the local-only alpha.

The alpha remains runnable as a behavior reference. The rewrite does not read its Canvas files, preserve its public APIs, retain its package layout, or ship migration adapters. Useful interaction and domain behavior is ported deliberately and proved in the new system.

## Product outcome

Crit is a local-first collaborative review canvas for live applications. Authors build canvases on their machine. After share, teammates review in the hosted UI. They do not install Crit. v1 is Frames only. Notes and comments are out of the rewrite until we design them again.

Local work is complete without an account:

```sh
npm install --save-dev @riff-refine/crit
npx crit init
npm run dev
```

Sharing adds a remote authority without replacing local authoring:

```sh
npx crit login https://crit.acme.internal
npx crit share checkout-redesign
```

`crit login` reconciles the local Person with the Access-authenticated Person. Share uses that bind.

A teammate opens the hosted review UI and signs in with company Access. Agents stay on the author's machine. Crit has no remote agent interface.

## System shape

```mermaid
flowchart LR
    subgraph Local["Author machine"]
        App["Application and Frame Bridge"]
        UI["Local Crit UI"]
        Daemon["crit dev"]
        LocalDB["SQLite authority and replica"]
        LocalArtifacts["Local artifacts"]
        App <--> UI
        UI <--> Daemon
        Daemon <--> LocalDB
        Daemon --> LocalArtifacts
    end

    subgraph Shared["Customer Cloudflare account"]
        Worker["Worker and hosted review UI"]
        Access["Cloudflare Access"]
        D1["D1 control plane"]
        CanvasDO["Canvas Durable Objects"]
        R2["R2 artifacts"]
        Reviewer["Teammate browser"]
        Access --> Worker
        Reviewer --> Access
        Worker --> D1
        Worker --> CanvasDO
        Worker --> R2
    end

    Daemon <--> Worker
```

The canonical record is an ordered Canvas ledger. A local `CanvasReplica` records work immediately, keeps pending intent through restarts, and synchronizes it by stable change ID. The shared authority stamps order and verified attribution. The hosted review UI talks to that authority directly. A reviewer has no local replica.

Frames store logical Representations. An Application Route resolves to localhost for its author and to a registered preview for a teammate. Canvas history never stores environment bindings or credentials.

## Target packages

```text
packages/
├── domain/           pure commands, projection, identity, Representations
├── protocol/         wire schemas, cursors, sync, bridge, and errors
├── authority/        canonical Canvas authority and conformance tests
├── replica/          optimistic local state, pending work, and rebase
├── representations/  resolution, capture, and RenderPlan
├── client/           typed HTTP and WebSocket client
├── react/            primary review UI
├── frame-bridge/     framework-neutral browser bridge
├── local/            daemon, SQLite, and local artifacts
├── cloudflare/       Worker, Durable Objects, D1, R2, Access, and hosted UI
└── cli/              init, dev, login, share, and sync
```

These are ownership boundaries from the first commit. We may begin in one repository, but we do not reproduce the alpha dependency graph inside them.

## Core interfaces

```ts
interface CanvasEngine {
  apply(projection: CanvasProjection, commands: readonly CanvasCommand[]): CanvasTransition
}

interface CanvasAuthority {
  open(canvasId: CanvasId): Promise<AuthorityView>
  submit(intent: ProposedCanvasChange, principal: TrustedPrincipal): Promise<AcceptedCanvasChange>
  changesAfter(canvasId: CanvasId, cursor: Cursor | null): Promise<ChangePage>
  subscribe(canvasId: CanvasId): AsyncIterable<AuthorityHint>
}

interface CanvasReplica {
  open(canvasId: CanvasId): Promise<ReplicaView>
  change(canvasId: CanvasId, commands: readonly CanvasCommand[]): Promise<ReplicaView>
  sync(canvasId: CanvasId): Promise<SyncResult>
  subscribe(canvasId: CanvasId): AsyncIterable<ReplicaEvent>
}

interface RepresentationRuntime {
  resolve(ref: RepresentationRef, context: ResolutionContext): Promise<RenderPlan>
  capture(ref: RepresentationRef, context: CaptureContext): Promise<ArtifactRef>
}
```

Storage, transport, React, and Cloudflare types do not cross these boundaries.

## Rewrite phases

1. [Target domain and protocol](phase-01-domain-and-protocol.md)
2. [Local authority and replica](phase-02-local-authority-and-replica.md)
3. [Local daemon and developer setup](phase-03-local-daemon-and-cli.md)
4. [Representations and Frame Bridge](phase-04-representations-and-bridge.md)
5. [Primary review UI](phase-05-review-ui.md)
6. [Cloudflare authority and control plane](phase-06-cloudflare-platform.md)
7. [Offline synchronization and sharing](phase-07-sync-and-sharing.md)
8. [Hosted review](phase-08-hosted-review.md)
9. [Installation, operations, and v1 release](phase-09-release.md)

Each phase produces a working vertical proof. There are no compatibility phases and no deferred legacy-deletion phase.

## Behavior reference

The rewrite intentionally ports these alpha behaviors:

- Stable Canvas entity IDs and atomic semantic command batches.
- Narrow content preconditions and explicit recoverable conflicts.
- Frame geometry, stacking, deletion, and review status.
- Immutable capture artifacts with cleanup after rejected commits.
- Infinite Canvas camera, iframe lifecycle, and a capture overlay on unselected Frames.
- Review status and visible Person, Agent, and presence information.
- Align and distribute, breakpoint presets, contextual help, pause-offscreen Frames, fullscreen, open in new tab, and developer copy-node-id. Not undo or redo, and not a fit-page display command.

It does not preserve alpha JSON, IndexedDB state, filesystem Canvas documents, URL-based Frame identity, Git-based authority, `CanvasSession`, `CanvasRepository`, Vite HTTP routes, command constructors, or package exports.

## Fixed v1 decisions

- One Installation is the tenant. There is no Organization model.
- Workspace remains in the data model as the authorization boundary. v1 does not expose Workspaces or ship workspace commands.
- Authors add Frames through the CLI or local agents. The review UI does not add Frames.
- A Frame's Representation is set at create. Snapshot adds a new artifact Frame. There is no generic representation-change action.
- Contextual help and keyboard shortcuts use TanStack Hotkeys.
- One SQLite Durable Object owns each shared Canvas ledger and projection.
- D1 is the control plane. R2 owns immutable artifacts.
- WebSockets notify. Cursor reads establish truth.
- The Frame Bridge is off in ordinary production builds and previews. Shared review previews require exact opt-in.
- Teammates review in the hosted UI. They do not install Crit.
- Agents author only through local tools. After share, review is human-led.
- Crit has no MCP server, Code Mode runtime, or OAuth agent grants.
- Notes and Comments are out of v1.
- Agent attribution identifies the Agent, the local Person who ran it, the execution, and optional reported runtime metadata.
- No CRDT, cross-Canvas transaction, automatic tunnel, unrestricted proxy, D1 ledger, Queue commit path, or multi-Organization tenancy.

## Verification

[The v1 todo](v1-todo.md) is the current done and remaining inventory. [The testing plan](testing.md) defines the shared conformance suites and end-to-end release proof. [The decision record](decision-record.md) captures the settled choices. [The synthesis](synthesis.md) explains why a clean rewrite replaced the earlier migration strategy.
