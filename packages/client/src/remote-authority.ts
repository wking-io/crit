import {
  AuthorityView,
  CanvasAuthority,
  CanvasNotFound,
  ChangeIdReused,
  ChangeRejected,
  CursorNotFound
} from "@crit/authority"
import { EmailAddress, type CanvasId } from "@crit/domain"
import {
  ChangeProtocol,
  encodeChangesAfterSearch,
  encodeSubmitCanvasChangeWire,
  isProtocolFailure,
  remoteCanvasChangesPath,
  remoteCanvasPath,
  type ChangePage,
  type ProtocolFailure,
  type SubmitChangeReceipt
} from "@crit/protocol"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse
} from "effect/unstable/http"

import { failProtocolResponse } from "./protocol-error.js"

const SubmitError = Schema.Union([
  CanvasNotFound,
  CursorNotFound,
  ChangeIdReused,
  ChangeRejected
])
const PullError = Schema.Union([
  CanvasNotFound,
  CursorNotFound
])
const OpenError = CanvasNotFound

export const RemoteAuthorityOptions = Schema.TaggedStruct("remoteAuthorityOptions", {
  baseUrl: Schema.String,
  accessEmail: Schema.optionalKey(EmailAddress)
})
export type RemoteAuthorityOptions = typeof RemoteAuthorityOptions.Type

export interface RemoteCanvasAuthorityService {
  readonly open: (
    canvasId: Parameters<CanvasAuthority["Service"]["open"]>[0]
  ) => Effect.Effect<
    AuthorityView,
    CanvasNotFound | ProtocolFailure
  >
  readonly submit: (
    ...args: Parameters<CanvasAuthority["Service"]["submit"]>
  ) => Effect.Effect<
    SubmitChangeReceipt,
    CanvasNotFound | CursorNotFound | ChangeIdReused | ChangeRejected | ProtocolFailure
  >
  readonly changesAfter: (
    query: Parameters<CanvasAuthority["Service"]["changesAfter"]>[0]
  ) => Effect.Effect<
    ChangePage,
    CanvasNotFound | CursorNotFound | ProtocolFailure
  >
}

const absorbProtocolFailure = <A, E>(
  effect: Effect.Effect<A, E>
): Effect.Effect<A, Exclude<E, ProtocolFailure>> =>
  effect.pipe(Effect.catchIf(isProtocolFailure, (failure) => Effect.die(failure)))

const rootUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "")

const withAccess = (
  request: HttpClientRequest.HttpClientRequest,
  accessEmail: EmailAddress | undefined
) => accessEmail === undefined
  ? request
  : HttpClientRequest.setHeader(
    request,
    "Cf-Access-Authenticated-User-Email",
    accessEmail
  )

const readJson = (response: HttpClientResponse.HttpClientResponse) =>
  response.text.pipe(
    Effect.flatMap((contents) => Effect.try({
      try: () => JSON.parse(contents),
      catch: (cause) => cause
    })),
    Effect.orDie
  )

const decodeProtocol = <A>(
  decoded: Result.Result<A, ProtocolFailure>
): Effect.Effect<A, ProtocolFailure> => Result.isSuccess(decoded)
  ? Effect.succeed(decoded.success)
  : Effect.fail(decoded.failure)

const failEncoded = <E>(
  encoded: Option.Option<E>
): Effect.Effect<never, E> => Option.isSome(encoded)
  ? Effect.fail(encoded.value)
  : Effect.die("Remote authority returned an unexpected error body")

const failRemoteBody = (
  response: HttpClientResponse.HttpClientResponse,
  body: unknown
): Effect.Effect<never, ProtocolFailure> => {
  const protocol = failProtocolResponse(response, body)
  return protocol ?? Effect.die(body)
}

export const overlayRemoteLedger = (
  create: CanvasAuthority["Service"]["create"],
  remote: RemoteCanvasAuthorityService
): CanvasAuthority["Service"] => ({
  create,
  open: (canvasId) => absorbProtocolFailure(remote.open(canvasId)),
  submit: (proposal, invocation) => absorbProtocolFailure(remote.submit(proposal, invocation)),
  changesAfter: (query) => absorbProtocolFailure(remote.changesAfter(query))
})

export const routeSharedCanvases = (
  local: CanvasAuthority["Service"],
  remote: RemoteCanvasAuthorityService,
  sharedCanvas: (canvasId: CanvasId) => Effect.Effect<boolean>
): CanvasAuthority["Service"] => ({
  create: local.create,
  open: (canvasId) => sharedCanvas(canvasId).pipe(
    Effect.flatMap((shared) => shared
      ? absorbProtocolFailure(remote.open(canvasId))
      : local.open(canvasId))
  ),
  submit: (proposal, invocation) => sharedCanvas(proposal.canvasId).pipe(
    Effect.flatMap((shared) => shared
      ? absorbProtocolFailure(remote.submit(proposal, invocation))
      : local.submit(proposal, invocation))
  ),
  changesAfter: (query) => sharedCanvas(query.canvasId).pipe(
    Effect.flatMap((shared) => shared
      ? absorbProtocolFailure(remote.changesAfter(query))
      : local.changesAfter(query))
  )
})

export const makeRemoteCanvasAuthority = (
  http: HttpClient.HttpClient,
  options: RemoteAuthorityOptions
): RemoteCanvasAuthorityService => {
  const baseUrl = rootUrl(options.baseUrl)
  const execute = (request: HttpClientRequest.HttpClientRequest) =>
    http.execute(withAccess(request, options.accessEmail)).pipe(Effect.orDie)

  const open: RemoteCanvasAuthorityService["open"] = (canvasId) =>
    execute(HttpClientRequest.get(`${baseUrl}${remoteCanvasPath(canvasId)}`)).pipe(
      Effect.flatMap((response) => Effect.gen(function*() {
        const body = yield* readJson(response)
        if (response.status === 200) {
          return Schema.decodeUnknownSync(AuthorityView)(body)
        }
        if (response.status === 404) {
          return yield* failEncoded(
            Schema.decodeUnknownOption(OpenError)(body)
          )
        }
        return yield* failRemoteBody(response, body)
      }))
    )

  const submit: RemoteCanvasAuthorityService["submit"] = (proposal, invocation) =>
    execute(HttpClientRequest.bodyJsonUnsafe(
      HttpClientRequest.post(`${baseUrl}${remoteCanvasChangesPath(proposal.canvasId)}`).pipe(
        HttpClientRequest.setHeader("content-type", "application/json")
      ),
      encodeSubmitCanvasChangeWire({ invocation, proposal })
    )).pipe(
      Effect.flatMap((response) => Effect.gen(function*() {
        const body = yield* readJson(response)
        if (response.status === 200) {
          return yield* decodeProtocol(ChangeProtocol.receipt.decode(body))
        }
        if (response.status === 404 || response.status === 409) {
          return yield* failEncoded(
            Schema.decodeUnknownOption(SubmitError)(body)
          )
        }
        return yield* failRemoteBody(response, body)
      }))
    )

  const changesAfter: RemoteCanvasAuthorityService["changesAfter"] = (query) =>
    execute(HttpClientRequest.get(
      `${baseUrl}${remoteCanvasChangesPath(query.canvasId)}?${encodeChangesAfterSearch({
        after: query.after,
        limit: query.limit
      })}`
    )).pipe(
      Effect.flatMap((response) => Effect.gen(function*() {
        const body = yield* readJson(response)
        if (response.status === 200) {
          return yield* decodeProtocol(ChangeProtocol.page.decode(body))
        }
        if (response.status === 404) {
          return yield* failEncoded(
            Schema.decodeUnknownOption(PullError)(body)
          )
        }
        return yield* failRemoteBody(response, body)
      }))
    )

  return { open, submit, changesAfter }
}

export class RemoteCanvasAuthority extends Context.Service<
  RemoteCanvasAuthority,
  RemoteCanvasAuthorityService
>()("@crit/client/RemoteCanvasAuthority") {
  static readonly layer = (options: RemoteAuthorityOptions) => Layer.effect(
    RemoteCanvasAuthority,
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      return RemoteCanvasAuthority.of(makeRemoteCanvasAuthority(http, options))
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
