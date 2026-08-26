import {
  AuthorityModel,
  CanvasAuthority
} from "@crit/authority"
import {
  makeRemoteCanvasAuthority,
  RemoteAuthorityOptions,
  routeSharedCanvases,
  type RemoteCanvasAuthorityService
} from "@crit/client"
import { type CanvasId } from "@crit/domain"
import {
  type CanvasReplicaService,
  type ReplicaOpenFailure
} from "@crit/replica"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"

import { LocalCanvasCatalog } from "./sqlite.js"
import { readLocalInstallation, readLocalShares } from "./share.js"

export const rebaseIfRemoteCursorUnknown = (
  replica: CanvasReplicaService,
  authority: CanvasAuthority["Service"]
) => (canvasId: CanvasId): Effect.Effect<void, ReplicaOpenFailure> =>
  Effect.gen(function*() {
    const view = yield* replica.open(canvasId)
    const page = yield* authority.changesAfter(AuthorityModel.changesAfter({
      canvasId,
      after: view.acknowledgedCursor,
      limit: AuthorityModel.pageLimit(1)
    })).pipe(Effect.result)
    if (page._tag === "Failure" && page.failure._tag === "cursorNotFound") {
      yield* replica.relink(canvasId)
    }
  })

const makeLinkedCanvasAuthority = (dataRoot: string) =>
  Effect.gen(function*() {
    const local = yield* CanvasAuthority
    const http = yield* HttpClient.HttpClient
    const remoteFor = (canvasId: CanvasId) =>
      Effect.gen(function*() {
        const shares = yield* readLocalShares(dataRoot)
        const share = shares.canvases.find((row) => row.canvasId === canvasId)
        if (share === undefined) {
          return yield* Effect.die(new Error(`shared canvas ${canvasId} missing from shares.json`))
        }
        const installation = yield* readLocalInstallation(dataRoot).pipe(Effect.orDie)
        const email = installation.principal.person.email
        return makeRemoteCanvasAuthority(http, RemoteAuthorityOptions.make({
          baseUrl: share.installationOrigin,
          ...(email._tag === "access" ? { accessEmail: email.address } : {})
        }))
      })
    const remote: RemoteCanvasAuthorityService = {
      open: (canvasId) => remoteFor(canvasId).pipe(Effect.flatMap((client) => client.open(canvasId))),
      submit: (proposal, invocation) => remoteFor(proposal.canvasId).pipe(
        Effect.flatMap((client) => client.submit(proposal, invocation))
      ),
      changesAfter: (query) => remoteFor(query.canvasId).pipe(
        Effect.flatMap((client) => client.changesAfter(query))
      )
    }
    return CanvasAuthority.of(routeSharedCanvases(
      local,
      remote,
      (canvasId) => readLocalShares(dataRoot).pipe(
        Effect.map((shares) => shares.canvases.some((row) => row.canvasId === canvasId)),
        Effect.orDie
      )
    ))
  })

export const LinkedCanvasAuthority = {
  layer: (dataRoot: string) => Layer.merge(
    Layer.effect(CanvasAuthority, makeLinkedCanvasAuthority(dataRoot)),
    Layer.effect(LocalCanvasCatalog, Effect.gen(function*() {
      return yield* LocalCanvasCatalog
    }))
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer)
  )
}
