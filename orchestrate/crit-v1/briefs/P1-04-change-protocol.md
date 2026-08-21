# P1-04 change protocol

GOAL

Define versioned proposed and accepted Canvas Change envelopes, opaque cursors, pages, receipts, and transport-safe failures around unauthored command payloads.

SCOPE

Write `packages/protocol` and the minimum domain command vocabulary required to prove unauthored nonempty batches. Do not implement Canvas behavior.

ACCEPTANCE

- Every external root has an explicit message kind and schema version.
- Proposed Changes contain stable Change ID, Canvas ID, observed cursor, and a nonempty ordered command batch.
- Accepted Changes add sequence, cursor, acceptance time, and trusted attribution.
- Retry receipts distinguish first acceptance from an identical retry without exposing private authorization-subject or digest metadata.
- Cursor is opaque to clients.
- Unknown versions and malformed or client-authored trusted fields produce typed transport-safe failures.
- Codecs round-trip between encoded JSON and domain types without platform globals.

VERIFY

Run checked-in JSON fixtures, strict decoding, version rejection, nonempty batch, trust-boundary, cursor opacity, target-boundary, build, typecheck, lint, package smoke, and diff proofs.

FORBIDDEN

No authority storage, sequence allocation, hashing implementation, HTTP types, WebSocket types, Canvas reducer, compatibility codec, staging, or commits.

REPORT

Return caller usage, public protocol surface, fixtures, commands, deviations, and unresolved authority-layer decisions.
