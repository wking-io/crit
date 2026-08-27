import {
  ChangeProtocol,
  negotiateWire,
  protocolFailureHttpStatus,
  type ProtocolFailure
} from "@crit/protocol"
import { Result, Schema } from "effect"

export const protocolFailureResponse = (failure: ProtocolFailure): Response =>
  new Response(JSON.stringify(ChangeProtocol.failure.encode(failure)), {
    status: protocolFailureHttpStatus(failure),
    headers: { "content-type": "application/json" }
  })

export const readJsonRequest = async (request: Request): Promise<Schema.Json | undefined> => {
  try {
    return Schema.decodeUnknownSync(Schema.Json)(await request.json())
  } catch {
    return undefined
  }
}

export const negotiateRequest = (
  input: Schema.Json,
  expected: { readonly kind: string; readonly schemaVersion: number }
): Response | undefined => {
  const negotiated = negotiateWire(input, expected)
  if (
    Result.isFailure(negotiated)
    && (
      negotiated.failure._tag === "unsupportedVersion"
      || negotiated.failure._tag === "messageKindMismatch"
    )
  ) {
    return protocolFailureResponse(negotiated.failure)
  }
  return undefined
}
