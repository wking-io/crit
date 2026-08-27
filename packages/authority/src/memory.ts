import { DomainValue, type CanvasId, type ChangeId } from "@crit/domain"
import type { AcceptedCanvasChange, Cursor } from "@crit/protocol"
import { Effect, Layer, Result, SynchronizedRef } from "effect"

import { AuthorityClock } from "./clock.js"
import {
  AuthorityFailure,
  AuthorityView,
  CanvasAuthority,
  type ChangesAfter
} from "./model.js"
import {
  AuthorityPolicy,
  FreshEvaluation,
  RetryEvaluation,
  type RetryRecord,
  type SubmitDecision
} from "./policy.js"

interface CanvasState {
  readonly view: AuthorityView
  readonly genesisCursor: Cursor
  readonly changes: readonly AcceptedCanvasChange[]
  readonly cursorPositions: ReadonlyMap<Cursor, number>
  readonly retries: ReadonlyMap<ChangeId, RetryRecord>
}

type Registry = ReadonlyMap<CanvasId, SynchronizedRef.SynchronizedRef<CanvasState>>

const make = Effect.gen(function*() {
  const clock = yield* AuthorityClock
  const registry = yield* SynchronizedRef.make<Registry>(new Map())

  const lookup = (canvasId: CanvasId) => SynchronizedRef.get(registry).pipe(
    Effect.flatMap((canvases) => {
      const state = canvases.get(canvasId)
      return state === undefined
        ? Effect.fail(AuthorityFailure.canvasNotFound({ canvasId }))
        : Effect.succeed(state)
    })
  )

  const create: CanvasAuthority["Service"]["create"] = (command, invocation) => Effect.suspend(() => {
    const ownedCommand = DomainValue.detach(command)
    const ownedInvocation = DomainValue.detach(invocation)
    return SynchronizedRef.modifyEffect(registry, (canvases) => {
      if (canvases.has(ownedCommand.canvasId)) {
        return Effect.fail(AuthorityFailure.canvasAlreadyExists({ canvasId: ownedCommand.canvasId }))
      }
      return clock.now.pipe(Effect.map((createdAt) => {
        const view = AuthorityPolicy.createCanvas({
          command: ownedCommand,
          invocation: ownedInvocation,
          createdAt
        })
        const state = SynchronizedRef.makeUnsafe<CanvasState>({
          view,
          genesisCursor: view.cursor,
          changes: [],
          cursorPositions: new Map([[view.cursor, 0]]),
          retries: new Map()
        })
        return [DomainValue.detach(view), new Map(canvases).set(ownedCommand.canvasId, state)] as const
      }))
    })
  })

  const open: CanvasAuthority["Service"]["open"] = (canvasId) => lookup(canvasId).pipe(
    Effect.flatMap(SynchronizedRef.get),
    Effect.map((state) => DomainValue.detach(state.view))
  )

  const submit: CanvasAuthority["Service"]["submit"] = (proposal, invocation) => Effect.suspend(() => {
    const ownedProposal = DomainValue.detach(proposal)
    const ownedInvocation = DomainValue.detach(invocation)
    return lookup(ownedProposal.canvasId).pipe(
      Effect.flatMap((state) => SynchronizedRef.modifyEffect(state, (current) => {
        const retry = AuthorityPolicy.evaluateRetry({
          proposal: ownedProposal,
          invocation: ownedInvocation,
          prior: current.retries.get(ownedProposal.changeId)
        })
        if (RetryEvaluation.$is("decided")(retry)) return Effect.succeed([retry.decision, current] as const)
        const fresh = AuthorityPolicy.evaluateFresh({
          proposal: ownedProposal,
          invocation: ownedInvocation,
          projection: current.view.projection,
          observedCursorKnown: ownedProposal.observedCursor === null ||
            current.cursorPositions.has(ownedProposal.observedCursor)
        })
        if (FreshEvaluation.$is("decided")(fresh)) return Effect.succeed([fresh.decision, current] as const)
        if (FreshEvaluation.$is("rejected")(fresh)) {
          return Effect.succeed([fresh.decision, {
            ...current,
            retries: new Map(current.retries).set(ownedProposal.changeId, fresh.retry)
          }] as const)
        }
        return clock.now.pipe(Effect.map((acceptedAt): readonly [SubmitDecision, CanvasState] => {
          const accepted = AuthorityPolicy.completeAcceptance({
            candidate: fresh.candidate,
            acceptedAt,
            position: current.changes.length + 1
          })
          return [Result.succeed(accepted.receipt), {
            view: AuthorityView.make({
              ...current.view,
              cursor: accepted.receipt.change.cursor,
              projection: accepted.projection
            }),
            genesisCursor: current.genesisCursor,
            changes: [...current.changes, accepted.receipt.change],
            cursorPositions: new Map(current.cursorPositions).set(
              accepted.receipt.change.cursor,
              accepted.receipt.change.sequence
            ),
            retries: new Map(current.retries).set(ownedProposal.changeId, accepted.retry)
          }]
        }))
      })),
      Effect.flatMap(AuthorityPolicy.decisionEffect)
    )
  })

  const changesAfter: CanvasAuthority["Service"]["changesAfter"] = (query: ChangesAfter) => lookup(query.canvasId).pipe(
    Effect.flatMap(SynchronizedRef.get),
    Effect.flatMap((state) => {
      let position = 0
      if (query.after !== null) {
        const knownPosition = state.cursorPositions.get(query.after)
        if (knownPosition === undefined) {
          return Effect.fail(AuthorityFailure.cursorNotFound({ canvasId: query.canvasId, cursor: query.after }))
        }
        position = knownPosition
      }
      const changes = state.changes.slice(position, position + query.limit)
      return Effect.succeed(DomainValue.detach(AuthorityPolicy.makeChangePage({
        query,
        genesisCursor: state.genesisCursor,
        position,
        total: state.changes.length,
        changes
      })))
    })
  )

  return { create, open, submit, changesAfter }
})

export const MemoryCanvasAuthority = {
  layer: Layer.effect(CanvasAuthority, make)
}
