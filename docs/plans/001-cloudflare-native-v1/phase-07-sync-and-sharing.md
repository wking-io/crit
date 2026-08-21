# Phase 7: Offline synchronization and sharing

## Outcome

Let multiple local replicas work offline and converge through the Cloudflare authority.

## Build

- Push pending changes by stable change ID and pull accepted changes after an opaque cursor.
- Use WebSocket hints to trigger cursor repair.
- Implement idempotent first share with stable share and import IDs plus a projection digest.
- Preserve local history in a local audit export. Begin remote history with an authenticated import receipt.
- Make Workspace switching affect future links only.

## Prove

- Two replicas edit offline, reconnect in either order, and converge.
- Lost, duplicate, and reordered socket notifications repair through cursor pulls.
- Independent changes survive; content collisions become recoverable conflicts with dependent pending work preserved.
- Repeated share returns one remote Canvas. A changed digest under the same share ID fails.
- Existing linked Canvases stay in their original Workspace after a switch.
