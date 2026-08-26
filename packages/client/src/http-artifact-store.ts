import type { ArtifactId, ArtifactRepresentation } from "@crit/domain"
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
        return execute(request, failure).pipe(
          Effect.flatMap((response) => {
            if (response.status === 200) {
              return responseJson(response, failure).pipe(
                Effect.flatMap((body) => Effect.try({
                  try: () => decodeArtifactStoredWire(body),
                  catch: () => failure
                }))
              )
            }
            if (response.status === 409) {
              return responseJson(response, failure).pipe(
                Effect.flatMap((body) =>
                  Schema.decodeUnknownEffect(ArtifactDigestConflict)(body).pipe(
                    Effect.mapError(() => failure)
                  )),
                Effect.flatMap((conflict) => Effect.fail(new ArtifactConflict({
                  artifactId: conflict.artifactId,
                  storedDigest: conflict.storedDigest,
                  suppliedDigest: conflict.suppliedDigest
                })))
              )
            }
            return Effect.fail(ioFailure(
              input.artifactId,
              "put",
              `Hosted artifact write returned ${response.status}`
            ))
          })
        )
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
        return execute(HttpClientRequest.get(url), failure).pipe(
          Effect.flatMap((response) => {
            if (response.status === 200) {
              return response.arrayBuffer.pipe(
                Effect.map((buffer) => new Uint8Array(buffer)),
                Effect.mapError(() => failure)
              )
            }
            if (response.status === 404) {
              return Effect.fail(new ArtifactNotFound({ artifact }))
            }
            if (response.status === 409) {
              return responseJson(response, failure).pipe(
                Effect.flatMap((body) =>
                  Schema.decodeUnknownEffect(ArtifactContentCorrupt)(body).pipe(
                    Effect.mapError(() => failure)
                  )),
                Effect.flatMap((corrupt) => Effect.fail(new ArtifactCorrupt({
                  artifact,
                  actualDigest: corrupt.actualDigest
                })))
              )
            }
            return Effect.fail(ioFailure(
              artifact.artifactId,
              "read",
              `Hosted artifact read returned ${response.status}`
            ))
          })
        )
      }

      return ArtifactStore.of({ put, read })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
