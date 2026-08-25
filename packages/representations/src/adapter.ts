import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

import {
  LiveContent,
  LiveContentUnreachable
} from "./runtime.js"

export {
  FileSystemArtifactStore,
  FileSystemArtifactStoreOpenFailure
} from "./file-system-store.js"
export type { FileSystemArtifactStoreOptions } from "./file-system-store.js"

export const LiveContentHttp = Layer.effect(LiveContent, Effect.gen(function*() {
  const http = yield* HttpClient.HttpClient
  return LiveContent.of({
    get: (url) => http.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((buffer) => new Uint8Array(buffer)),
      Effect.mapError((cause) => new LiveContentUnreachable({
        url,
        reason: String(cause)
      }))
    )
  })
}))
