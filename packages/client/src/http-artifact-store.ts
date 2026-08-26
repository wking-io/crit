import {
  ArtifactRepresentation,
  type ArtifactId
} from "@crit/domain"
import {
  ArtifactContentCorrupt,
  ArtifactDigestConflict,
  decodeArtifactStoredWire,
  remoteArtifactPath
} from "@crit/protocol"
import {
  ArtifactConflict,
  ArtifactCorrupt,
  ArtifactNotFound,
  ArtifactStore,
  ArtifactStoreIoFailure
} from "@crit/representations"
import { Effect, Layer, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse
} from "effect/unstable/http"

const rootUrl = (baseUrl: string): string => baseUrl.replace(/\/$/, "")

const ioFailure = (
  artifactId: ArtifactId,
  operation: "put" | "read",
  reason: string
) => new ArtifactStoreIoFailure({ artifactId, operation, reason })

const responseJson = (
  response: HttpClientResponse.HttpClientResponse,
  failure: ArtifactStoreIoFailure
): Effect.Effect<unknown, ArtifactStoreIoFailure> => response.text.pipe(
  Effect.mapError(() => failure),
  Effect.flatMap((contents) => Effect.try({
    try: () => JSON.parse(contents),
    catch: () => failure
  }))
)

export const HttpArtifactStore = {
  layer: (
    options: { readonly baseUrl: string }
  ): Layer.Layer<ArtifactStore> => Layer.effect(
    ArtifactStore,
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      const execute = (
        request: HttpClientRequest.HttpClientRequest,
        failure: ArtifactStoreIoFailure
      ) => http.execute(request).pipe(Effect.mapError(() => failure))

      const put: ArtifactStore["Service"]["put"] = (input) => {
        const failure = ioFailure(input.artifactId, "put", "Hosted artifact write failed")
        const request = HttpClientRequest.put(
          `${rootUrl(options.baseUrl)}${remoteArtifactPath(input.artifactId)}`
        ).pipe(
          HttpClientRequest.bodyUint8Array(
            Uint8Array.from(input.bytes),
            "application/octet-stream"
          )
        )
        return Effect.gen(function*() {
          const response = yield* execute(request, failure)
          if (response.status === 200) {
            const body = yield* responseJson(response, failure)
            const stored = yield* Effect.try({
              try: () => decodeArtifactStoredWire(body),
              catch: () => failure
            })
            return ArtifactRepresentation.make({
              artifactId: stored.artifactId,
              digest: stored.digest
            })
          }
          if (response.status === 409) {
            const body = yield* responseJson(response, failure)
            const conflict = yield* Schema.decodeUnknownEffect(
              ArtifactDigestConflict
            )(body).pipe(Effect.mapError(() => failure))
            return yield* Effect.fail(new ArtifactConflict({
              artifactId: conflict.artifactId,
              storedDigest: conflict.storedDigest,
              suppliedDigest: conflict.suppliedDigest
            }))
          }
          return yield* Effect.fail(ioFailure(
              input.artifactId,
              "put",
              `Hosted artifact write returned ${response.status}`
          ))
        })
      }

      const read: ArtifactStore["Service"]["read"] = (
        artifact: ArtifactRepresentation
      ) => {
        const failure = ioFailure(
          artifact.artifactId,
          "read",
          "Hosted artifact read failed"
        )
        const url = `${rootUrl(options.baseUrl)}${remoteArtifactPath(
          artifact.artifactId
        )}?digest=${encodeURIComponent(artifact.digest)}`
        return Effect.gen(function*() {
          const response = yield* execute(HttpClientRequest.get(url), failure)
          if (response.status === 200) {
            const buffer = yield* response.arrayBuffer.pipe(
              Effect.mapError(() => failure)
            )
            return new Uint8Array(buffer)
          }
          if (response.status === 404) {
            return yield* Effect.fail(new ArtifactNotFound({ artifact }))
          }
          if (response.status === 409) {
            const body = yield* responseJson(response, failure)
            const corrupt = yield* Schema.decodeUnknownEffect(
              ArtifactContentCorrupt
            )(body).pipe(Effect.mapError(() => failure))
            return yield* Effect.fail(new ArtifactCorrupt({
              artifact,
              actualDigest: corrupt.actualDigest
            }))
          }
          return yield* Effect.fail(ioFailure(
              artifact.artifactId,
              "read",
              `Hosted artifact read returned ${response.status}`
          ))
        })
      }

      return ArtifactStore.of({ put, read })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
