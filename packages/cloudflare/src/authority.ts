import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  AuthorityClock,
  AuthorityFailure,
  AuthorityView,
  CanvasAuthority
} from "@crit/authority"
import { AuthorityPolicy } from "@crit/authority/adapter"
import { DomainValue, type CanvasId } from "@crit/domain"
import { Effect, Layer, Scope, SynchronizedRef } from "effect"

import { makeDatabase } from "./database.js"
import {
  createOneCanvas,
  makeOneCanvas,
  type OneCanvas
} from "./one-canvas.js"

type Registry = ReadonlyMap<CanvasId, OneCanvas>

export interface CloudflareCanvasAuthorityOptions {
  readonly directory: string
}

const make = (options: CloudflareCanvasAuthorityOptions) => Effect.gen(function*() {
  const clock = yield* AuthorityClock
  const scope = yield* Effect.scope
  const registry = yield* SynchronizedRef.make<Registry>(new Map())

  const pathFor = (canvasId: CanvasId): string =>
    join(options.directory, `${canvasId}.sqlite`)

  const lookup = (canvasId: CanvasId) => SynchronizedRef.modifyEffect(registry, (canvases) => {
    const cached = canvases.get(canvasId)
    if (cached !== undefined) return Effect.succeed([cached, canvases])
    const path = pathFor(canvasId)
    if (!existsSync(path)) {
      return Effect.fail(AuthorityFailure.canvasNotFound({ canvasId }))
    }
    return makeDatabase({ path }).pipe(
      Effect.flatMap((sqlite) => makeOneCanvas({ canvasId, sqlite, clock })),
      Effect.provideService(Scope.Scope, scope),
      Effect.catchTag("CloudflareDatabaseOpenFailure", Effect.die),
      Effect.map((isolate) => [isolate, new Map(canvases).set(canvasId, isolate)])
    )
  })

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
        const path = pathFor(ownedCommand.canvasId)
        return clock.now.pipe(Effect.flatMap((createdAt) => {
          const view = AuthorityPolicy.createCanvas({
            command: ownedCommand,
            invocation: ownedInvocation,
            createdAt
          })
          return makeDatabase({ path }).pipe(
            Effect.flatMap((sqlite) => createOneCanvas({ view, sqlite, clock })),
            Effect.provideService(Scope.Scope, scope),
            Effect.catchTag("CloudflareDatabaseOpenFailure", Effect.die),
            Effect.map((isolate): readonly [AuthorityView, Registry] => [
              DomainValue.detach(view),
              new Map(canvases).set(ownedCommand.canvasId, isolate)
            ])
          )
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
  layer: (options: CloudflareCanvasAuthorityOptions) =>
    Layer.effect(CanvasAuthority, make(options))
}
