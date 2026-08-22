import { type Result, Schema } from "effect"

const FailureLocation = Schema.Literals(["message", "change", "command"])
const FailureMessage = Schema.Trimmed.check(Schema.isNonEmpty())

const MalformedMessage = Schema.TaggedStruct("malformed-message", {
  location: FailureLocation,
  message: FailureMessage
})
const MessageKindMismatch = Schema.TaggedStruct("message-kind-mismatch", {
  location: FailureLocation,
  message: FailureMessage
})
const UnsupportedVersion = Schema.TaggedStruct("unsupported-version", {
  location: FailureLocation,
  message: FailureMessage
})
const TrustedField = Schema.TaggedStruct("trusted-field", {
  location: FailureLocation,
  message: FailureMessage
})

export const ProtocolFailureSchema = Schema.Union([
  MalformedMessage,
  MessageKindMismatch,
  UnsupportedVersion,
  TrustedField
])
export type ProtocolFailure = typeof ProtocolFailureSchema.Type

export type DecodeResult<A> = Result.Result<A, ProtocolFailure>
