# One failure vocabulary for the durable Canvas path

**Strength:** Strong (top architecture recommendation) · **Dependency category:** in-process

## Files

- `src/runtime/canvas-repository.ts:11-47` — `DocumentNotFound/AlreadyExists/Malformed/StorageFailed`
- `src/session/crit-client.ts:6-41` — `CritClientNotFound/InvalidDocument/CommandFailed/Unavailable`
- `src/http/contract.ts` — `CritHttpErrorCode` literals + `clientErrorResponse`
- `src/http/client.ts:34-69` — `responseError`
- `src/runtime/canvas-repository-crit-client.ts:40-137` — `toClientError` + `mapForId`

## Problem

The same five failure conditions (missing Canvas, rejected command, malformed
document, storage unavailable, document too large) are named four different
ways along one write path, and every seam crossing carries a hand-written
translation table. ~100 of the in-process client adapter's 178 lines are pure
error renaming, including a two-stage dance where `toClientError` emits
`id: "unknown"` and `mapForId` immediately patches the real id back in.

The tables have already drifted: the HTTP client decoder collapses
`invalid-request` and `invalid-document` into one client error, so a malformed
request becomes indistinguishable from a malformed stored document
(`src/http/client.ts:51-55`). None of the translation code is unit-tested.

Deletion test: keeping one vocabulary and deleting the other three makes the
complexity vanish rather than reappear — the mappings are pass-throughs.

## Proposed deepening

Adopt one failure schema for the Canvas persistence interface — the
`CritClient` error set is the natural survivor since it already round-trips
HTTP — and have the Canvas Repository consumers and the wire codec share it.
Serialize it with Effect Schema; `toClientError`, `mapForId`,
`clientErrorResponse`, and `responseError` collapse into one encode/decode
pair, testable as a single round-trip property.

Start with issue 011 (`Canvas.fromDocument`) — it is the first step of this
change.

## Origin

Architecture review, candidate 1 (top recommendation), 2026-08-09.
