import { readProtocolFailure, type ProtocolFailure } from "@crit/protocol"
import { Effect, Option, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"

export const failProtocolResponse = (
  response: HttpClientResponse.HttpClientResponse,
  body: Schema.Json
): Effect.Effect<never, ProtocolFailure> | undefined => {
  if (response.status !== 400 && response.status !== 426) return undefined
  const failure = readProtocolFailure(body)
  return Option.isSome(failure) ? Effect.fail(failure.value) : undefined
}
