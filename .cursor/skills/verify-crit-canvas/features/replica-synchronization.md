# Replica synchronization

## Sub-features

Initial open, WebSocket refresh notifications, no-op synchronization, pending changes, and connection status.

## How to get to it (user POV)

Open the seeded v1 Canvas and wait for the header to report that it is synchronized.

## Driving it with Chrome CDP

Navigate to the v1 performance URL, require the probe to initialize, and confirm the visible synchronized state before measuring. Inspect daemon request volume when a trace unexpectedly grows.

## Gotchas

WebSockets are notification hints; cursor pulls establish truth. An empty pull must not publish another replica-changed notification or it creates an open/sync feedback loop.
