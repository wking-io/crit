import { Option, Result, Schema, SchemaAST } from "effect"

import {
  ProtocolFailure,
  ProtocolFailureSchema,
  type DecodeResult,
  type ProtocolFailure as ProtocolFailureValue
} from "./failure.js"
import { FailureWire } from "./wire.js"

const Header = Schema.Struct({
  kind: Schema.String,
  schemaVersion: Schema.Number
})
const exact: SchemaAST.ParseOptions = { onExcessProperty: "error" }
const readHeader = Schema.decodeUnknownOption(Header)
const readFailureWire = Schema.decodeUnknownOption(FailureWire, exact)
const readProtocolFailureSchema = Schema.decodeUnknownOption(ProtocolFailureSchema)

export const formatUnsupportedVersion = (input: {
  readonly requestedVersion: number
  readonly supportedVersion: number
}): string =>
  `Schema version ${input.requestedVersion} is unsupported. This installation speaks version ${input.supportedVersion}. Upgrade Crit so the client and installation match.`

export const formatProtocolFailure = (failure: ProtocolFailureValue): string => failure.message

export const protocolFailureHttpStatus = (
  failure: ProtocolFailureValue
): 400 | 426 => failure._tag === "unsupportedVersion" ? 426 : 400

export const isProtocolFailure = (
  value: { readonly _tag: string }
): value is ProtocolFailureValue => Option.isSome(readProtocolFailureSchema(value))

export const negotiateWire = (
  input: Schema.Json,
  expected: { readonly kind: string; readonly schemaVersion: number }
): DecodeResult<typeof Header.Type> => {
  const header = readHeader(input)
  if (Option.isNone(header)) {
    return Result.fail(ProtocolFailure.malformedMessage({
      location: "message",
      message: "Message header is malformed"
    }))
  }
  if (header.value.kind !== expected.kind) {
    return Result.fail(ProtocolFailure.messageKindMismatch({
      location: "message",
      message: "Message kind does not match this codec"
    }))
  }
  if (header.value.schemaVersion !== expected.schemaVersion) {
    return Result.fail(ProtocolFailure.unsupportedVersion({
      location: "message",
      requestedVersion: header.value.schemaVersion,
      supportedVersion: expected.schemaVersion,
      message: formatUnsupportedVersion({
        requestedVersion: header.value.schemaVersion,
        supportedVersion: expected.schemaVersion
      })
    }))
  }
  return Result.succeed(header.value)
}

export const readProtocolFailure = (body: Schema.Json): Option.Option<ProtocolFailureValue> => {
  const header = readHeader(body)
  if (Option.isNone(header) || header.value.kind !== "protocol-failure") return Option.none()
  const negotiated = negotiateWire(body, {
    kind: "protocol-failure",
    schemaVersion: 1
  })
  if (Result.isFailure(negotiated)) return Option.some(negotiated.failure)
  const wire = readFailureWire(body)
  return Option.map(wire, (value) => value.failure)
}
