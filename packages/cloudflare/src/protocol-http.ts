import {
  ChangeProtocol,
  negotiateWire,
  protocolFailureHttpStatus,
  type ProtocolFailure
} from "@crit/protocol"
import { Result } from "effect"

export const protocolFailureResponse = (failure: ProtocolFailure): Response =>
  new Response(JSON.stringify(ChangeProtocol.failure.encode(failure)), {
    status: protocolFailureHttpStatus(failure),
    headers: { "content-type": "application/json" }
  })

export const negotiateRequest = (
  input: unknown,
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
