import {
  AuthorityClock,
  AuthorityFailure,
  AuthorityView,
  CanvasAuthority
} from "@crit/authority"
import { AuthorityPolicy } from "@crit/authority/adapter"
import { DomainValue, type CanvasId } from "@crit/domain"
import { Effect, Layer, SynchronizedRef } from "effect"

import { makeOneCanvas, type OneCanvas } from "./one-canvas.js"

type Registry = ReadonlyMap<CanvasId, OneCanvas>

const make = Effect.gen(function*() {
  const clock = yield* AuthorityClock
  const registry = yield* SynchronizedRef.make<Registry>(new Map())

  const lookup = (canvasId: CanvasId) => SynchronizedRef.get(registry).pipe(
    Effect.flatMap((canvases) => {
      const isolate = canvases.get(canvasId)
      return isolate === undefined
        ? Effect.fail(AuthorityFailure.canvasNotFound({ canvasId }))
        : Effect.succeed(isolate)
    })
  )

  const create: CanvasAuthority["Service"]["create"] = (command, invocation) =>
    Effect.suspend(() => {
      const ownedCommand = DomainValue.detach(command)
      const ownedInvocation = DomainValue.detach(invocation)
      return SynchronizedRef.modifyEffect(registry, (canvases) => {
        if (canvases.has(ownedCommand.canvasId)) {
          return Effect.fail(AuthorityFailure.canvasAlreadyExists({
            canvasId: ownedCommand.canvasId
          }))
        }
        return clock.now.pipe(Effect.map((createdAt): readonly [AuthorityView, Registry] => {
          const view = AuthorityPolicy.createCanvas({
            command: ownedCommand,
            invocation: ownedInvocation,
            createdAt
          })
          const isolate = makeOneCanvas({ view, clock })
          return [
            DomainValue.detach(view),
            new Map(canvases).set(ownedCommand.canvasId, isolate)
          ]
        }))
      })
    })

  const open: CanvasAuthority["Service"]["open"] = (canvasId) => lookup(canvasId).pipe(
    Effect.flatMap((isolate) => isolate.open())
  )

  const submit: CanvasAuthority["Service"]["submit"] = (proposal, invocation) =>
    Effect.suspend(() => {
      const ownedProposal = DomainValue.detach(proposal)
      const ownedInvocation = DomainValue.detach(invocation)
      const { canvasId, ...oneCanvasProposal } = ownedProposal
      return lookup(canvasId).pipe(
        Effect.flatMap((isolate) => isolate.submit(oneCanvasProposal, ownedInvocation))
      )
    })

  const changesAfter: CanvasAuthority["Service"]["changesAfter"] = (query) => {
    const { canvasId, ...oneCanvasQuery } = query
    return lookup(canvasId).pipe(
      Effect.flatMap((isolate) => isolate.changesAfter(oneCanvasQuery))
    )
  }

  return { create, open, submit, changesAfter }
})

export const CloudflareCanvasAuthority = {
  layer: Layer.effect(CanvasAuthority, make)
}
