import { AuthorityView, PersonInvocation } from "@crit/authority"
import { Id, PersonAttribution, decodeCanvasCommandBatch, emptyCanvasProjection } from "@crit/domain"
import { ProtocolValue, type AcceptedCanvasChange, type ChangePage } from "@crit/protocol"
import { Effect, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { ReplicaModel } from "../src/index.js"
import { ReplicaPolicy } from "../src/policy.js"
import { ReplicaConformance } from "../src/testing.js"

const canvasId = Id.canvas("canvas_replica_policy")
const genesisCursor = ProtocolValue.cursor("cursor_replica_genesis")
const acceptedCursor = ProtocolValue.cursor("cursor_replica_accepted")
const person = Schema.decodeUnknownSync(PersonInvocation)({
  _tag: "person",
  principal: {
    _tag: "person",
    subject: "oidc|replica-policy",
    person: { _tag: "person", personId: "person_replica_policy", displayName: "Replica" }
  }
})
const commands = decodeCanvasCommandBatch([{ _tag: "rename-canvas", expectedTitle: "Original", title: "Accepted" }])
const changeId = Id.change("change_replica_policy")
const initial = () => ReplicaPolicy.initialize(AuthorityView.make({
  canvasId,
  createdAt: "2026-08-22T00:00:00.000Z",
  createdBy: PersonAttribution.make({ person: person.principal.person }),
  cursor: genesisCursor,
  projection: emptyCanvasProjection(canvasId, "Original")
}))
const accepted: AcceptedCanvasChange = {
  canvasId,
  changeId,
  observedCursor: genesisCursor,
  commands,
  sequence: ProtocolValue.sequence(1),
  cursor: acceptedCursor,
  acceptedAt: "2026-08-22T00:00:01.000Z",
  attribution: PersonAttribution.make({ person: person.principal.person })
}
const page: ChangePage = { canvasId, after: genesisCursor, changes: [accepted], cursor: acceptedCursor, hasMore: false }

const enqueued = () => Result.getOrThrow(ReplicaPolicy.enqueue(
  initial(),
  ReplicaModel.change({ canvasId, commands }),
  person,
  changeId
))

describe("ReplicaPolicy reconciliation", () => {
  it("satisfies reusable receipt and page idempotency", async () => {
    await Effect.runPromise(ReplicaConformance.receiptAndPageIdempotency)
  })
  it("keeps receipts unconfirmed until the accepted page arrives", () => {
    const receipt = { disposition: "first-acceptance" as const, change: accepted }
    const unconfirmed = Result.getOrThrow(ReplicaPolicy.receipt(enqueued(), receipt))
    expect(unconfirmed.acknowledgedCursor).toBe(genesisCursor)
    expect(unconfirmed.pending[0]?.state._tag).toBe("accepted-unconfirmed")
    const duplicate = Result.getOrThrow(ReplicaPolicy.receipt(unconfirmed, receipt))
    expect(duplicate.pending).toHaveLength(1)
    const pulled = Result.getOrThrow(ReplicaPolicy.incorporatePage(duplicate, page))
    expect(pulled.state.acknowledgedCursor).toBe(acceptedCursor)
    expect(pulled.state.pending).toHaveLength(0)
  })

  it("reconciles self-acceptance before a delayed receipt idempotently", () => {
    const pulled = Result.getOrThrow(ReplicaPolicy.incorporatePage(enqueued(), page))
    const delayed = Result.getOrThrow(ReplicaPolicy.receipt(pulled.state, {
      disposition: "identical-retry",
      change: accepted
    }))
    const duplicatePage = Result.getOrThrow(ReplicaPolicy.incorporatePage(delayed, page))
    expect(duplicatePage.pulled).toBe(0)
    expect(duplicatePage.state.accepted).toHaveLength(1)
    expect(duplicatePage.state.pending).toHaveLength(0)
  })
})
