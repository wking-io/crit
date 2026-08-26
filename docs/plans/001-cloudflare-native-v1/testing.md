# Testing the Cloudflare-native v1 program

[Back to the overview](overview.md)

## Test layers

### Domain replay

Run the same initial projection and accepted changes through `CanvasEngine`. Assert an identical projection byte-for-byte. Assert that a rejected batch changes nothing.

### Authority conformance

Run one suite against the in-memory reference, local SQLite authority, and Canvas Durable Object. Cover creation, gap-free ordering, duplicate `changeId`, atomic failure, cursor pagination, projection rebuild, restart, and concurrent submission.

### Replica conformance

Run one suite against the local replica store. Cover offline restart, pending replay, accepted remote ordering, duplicate responses, rejected changes, conflicts, first share, unlink prohibition while pending, and no silent data loss.

### Representation conformance

Run one suite against local and shared resolvers. Cover `applicationRoute`, `webUrl`, `artifact`, missing bindings, revision mismatch, blocked embedding, and immutable artifact integrity.

### Protocol contracts

Keep versioned fixtures for HTTP, WebSocket, manifest, and bridge messages. Decode every fixture at the boundary. Reject unknown incompatible versions with a structured upgrade error.

### Security

Prove that the server ignores client-supplied actor and timestamp fields. Prove that Access and Workspace policy cannot cross an unauthorized Workspace. Prove that ordinary production builds and ordinary production previews contain no Frame Bridge markers. Prove that only an explicit shared-review-preview opt-in adds them. Prove that `/mcp` and agent OAuth routes do not exist.

## Runtime proofs

### Local workflow

Start the host application and `crit dev`. Create a Canvas, add a live Frame through the UI, make another change through a local agent, restart both processes, and confirm that all work returns.

### Collaboration workflow

Open one shared Canvas from two isolated local replicas. Disconnect both. Make independent edits. Reconnect them in opposite order. Confirm that the Durable Object assigns one gap-free order and both replicas converge. Create one destructive collision and confirm that the losing local change remains visible and recoverable.

### Representation workflow

Resolve one `applicationRoute` Frame to localhost in the developer UI and to a registered preview in the hosted review UI. Remove the shared binding and confirm that the hosted UI shows an unavailable state without mutating the Frame. Capture the Frame and confirm that both viewers render the same R2 artifact digest.

### Hosted review workflow

Open the shared Canvas in a browser with no Crit install. Complete Access sign-in to the default Workspace. View Frames and a shared preview as a Person. Confirm that `/mcp` is not a route.

### Installation workflow

Deploy into an empty Cloudflare account from the published package. Confirm that the Installation uses its implicit default Workspace without exposing workspace product. Exercise a target-schema upgrade and confirm that Canvases and artifacts remain readable.

## Project checks

Run these commands in every phase:

```sh
npm run lint
npm run typecheck
npm test
```

Run `npm run verify` before each phase merges. Cloudflare phases also run the Workers Vitest pool, generated Wrangler types, local `wrangler dev` integration tests, and a deployed smoke test against a disposable Cloudflare environment.

## Release rule

Alpha tests are evidence for behavior selection, not release gates for the new implementation. Every accepted behavior receives a target-system test. Stable v1 has no compatibility suite and no alpha-state import fixture.
