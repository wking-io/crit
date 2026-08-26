import { type Result, Schema } from "effect"

const FailureLocation = Schema.Literals(["message", "change", "command"])
const FailureMessage = Schema.Trimmed.check(Schema.isNonEmpty())

const MalformedMessage = Schema.TaggedStruct("malformedMessage", {
  location: FailureLocation,
  message: FailureMessage
})
const MessageKindMismatch = Schema.TaggedStruct("messageKindMismatch", {
  location: FailureLocation,
  message: FailureMessage
})
const UnsupportedVersion = Schema.TaggedStruct("unsupportedVersion", {
  location: FailureLocation,
  message: FailureMessage
})
const TrustedField = Schema.TaggedStruct("trustedField", {
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
