import {
  AuthorityView,
  CanvasAuthority,
  CanvasNotFound,
  ChangeIdReused,
  ChangeRejected,
  CursorNotFound
} from "@crit/authority"
import { EmailAddress } from "@crit/domain"
import {
  ChangeProtocol,
  encodeChangesAfterSearch,
  encodeSubmitCanvasChangeWire,
  remoteCanvasChangesPath,
  remoteCanvasPath
} from "@crit/protocol"
import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse
} from "effect/unstable/http"

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
  readonly open: CanvasAuthority["Service"]["open"]
  readonly submit: CanvasAuthority["Service"]["submit"]
  readonly changesAfter: CanvasAuthority["Service"]["changesAfter"]
}

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

const decodeOrDie = <A>(
  decoded: Result.Result<A, { readonly _tag: string }>
): Effect.Effect<A> => Result.isSuccess(decoded)
  ? Effect.succeed(decoded.success)
  : Effect.die(decoded.failure)

const failEncoded = <E>(
  encoded: Option.Option<E>
): Effect.Effect<never, E> => Option.isSome(encoded)
  ? Effect.fail(encoded.value)
  : Effect.die("Remote authority returned an unexpected error body")

export const overlayRemoteLedger = (
  create: CanvasAuthority["Service"]["create"],
  remote: RemoteCanvasAuthorityService
): CanvasAuthority["Service"] => ({
  create,
  open: remote.open,
  submit: remote.submit,
  changesAfter: remote.changesAfter
})

export class RemoteCanvasAuthority extends Context.Service<
  RemoteCanvasAuthority,
  RemoteCanvasAuthorityService
>()("@crit/client/RemoteCanvasAuthority") {
  static readonly layer = (options: RemoteAuthorityOptions) => Layer.effect(
    RemoteCanvasAuthority,
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
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
            return yield* Effect.die(body)
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
              return yield* decodeOrDie(ChangeProtocol.receipt.decode(body))
            }
            if (response.status === 404 || response.status === 409) {
              return yield* failEncoded(
                Schema.decodeUnknownOption(SubmitError)(body)
              )
            }
            return yield* Effect.die(body)
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
              return yield* decodeOrDie(ChangeProtocol.page.decode(body))
            }
            if (response.status === 404) {
              return yield* failEncoded(
                Schema.decodeUnknownOption(PullError)(body)
              )
            }
            return yield* Effect.die(body)
          }))
        )

      return RemoteCanvasAuthority.of({ open, submit, changesAfter })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
