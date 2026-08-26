import { Option, Result, Schema, SchemaAST } from "effect"

import type {
  AcceptedCanvasChange,
  ChangePage,
  ProposedCanvasChange,
  SubmitChangeReceipt
} from "./change.js"
import type { DecodeResult, ProtocolFailure } from "./failure.js"
import {
  AcceptedWire,
  FailureWire,
  PageWire,
  ProposedWire,
  ReceiptWire
} from "./wire.js"

const Header = Schema.Struct({ kind: Schema.String, schemaVersion: Schema.Number })
const CommandHeader = Schema.Struct({ _tag: Schema.String })
const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const JsonArray = Schema.Array(Schema.Json)
const exact: SchemaAST.ParseOptions = { onExcessProperty: "error" }
const readHeader = Schema.decodeUnknownOption(Header)
const readCommandHeader = Schema.decodeUnknownOption(CommandHeader)
const readRecord = Schema.decodeUnknownOption(JsonRecord, exact)
const readArray = Schema.decodeUnknownOption(JsonArray, exact)
const readProposedWire = Schema.decodeUnknownOption(ProposedWire, exact)
const readAcceptedWire = Schema.decodeUnknownOption(AcceptedWire, exact)
const readPageWire = Schema.decodeUnknownOption(PageWire, exact)
const readReceiptWire = Schema.decodeUnknownOption(ReceiptWire, exact)
const readFailureWire = Schema.decodeUnknownOption(FailureWire, exact)

const fail = (
  tag: ProtocolFailure["_tag"],
  location: ProtocolFailure["location"],
  message: string
): DecodeResult<never> => Result.fail({ _tag: tag, location, message })

const decoded = <A>(value: A): DecodeResult<A> => Result.succeed(value)

const preflight = (
  input: Schema.Json,
  expectedKind: string
): DecodeResult<Schema.Json> => {
  const header = readHeader(input)
  if (Option.isNone(header)) {
    return fail("malformed-message", "message", "Message header is malformed")
  }
  if (header.value.kind !== expectedKind) {
    return fail("message-kind-mismatch", "message", "Message kind does not match this codec")
  }
  if (header.value.schemaVersion !== (expectedKind === "protocol-failure" ? 1 : 2)) {
    return fail("unsupported-version", "message", "Message schema version is unsupported")
  }
  return decoded(input)
}

const trustedFields = new Set([
  "acceptedAt", "attribution", "sequence", "cursor", "subject", "actor",
  "author", "person", "agent", "editedAt", "at", "time", "digest", "hash",
  "personId", "agentId", "executionId",
  "delegatedBy", "reportedRuntime", "harness", "model", "source", "sessionId",
  "taskId", "displayName", "email", "address"
])

const containsTrustedField = (input: Schema.Json): boolean => {
  const record = readRecord(input)
  if (Option.isSome(record)) {
    return Object.entries(record.value).some(([key, value]) =>
      key !== "state" && (trustedFields.has(key) || containsTrustedField(value))
    )
  }
  const array = readArray(input)
  return Option.isSome(array) && array.value.some(containsTrustedField)
}

const injectedField = (input: Schema.Json): ProtocolFailure["location"] | undefined => {
  const root = readRecord(input)
  if (Option.isNone(root)) return undefined
  if (Object.entries(root.value).some(([key, value]) => key !== "commands" && (trustedFields.has(key) || containsTrustedField(value)))) return "message"
  const commands = root.value.commands === undefined
    ? Option.none()
    : readArray(root.value.commands)
  if (Option.isNone(commands)) return undefined
  for (const command of commands.value) {
    const record = readRecord(command)
    if (Option.isSome(record) && containsTrustedField(command)) {
      return "command"
    }
  }
  return undefined
}

const hasUnknownCommandKind = (input: Schema.Json): boolean => {
  const root = readRecord(input)
  if (Option.isNone(root) || root.value.commands === undefined) return false
  const commands = readArray(root.value.commands)
  if (Option.isNone(commands)) return false
  for (const command of commands.value) {
    const header = readCommandHeader(command)
    if (Option.isSome(header) && !new Set([
      "renameCanvas", "addFrame", "setFrameTitle", "setFrameRepresentation",
      "setFrameStatus", "setFrameGeometry", "removeFrame", "placeCanvasItem"
    ]).has(header.value._tag)) {
      return true
    }
  }
  return false
}

const stripAccepted = (wire: typeof AcceptedWire.Type): AcceptedCanvasChange => {
  const { kind: _kind, schemaVersion: _schemaVersion, ...change } = wire
  return change
}

const toAcceptedWire = (change: AcceptedCanvasChange): typeof AcceptedWire.Type => ({
  kind: "accepted-canvas-change",
  schemaVersion: 2,
  ...change
})

const decodeProposed = (input: Schema.Json): DecodeResult<ProposedCanvasChange> => {
  const header = preflight(input, "proposed-canvas-change")
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const injection = injectedField(input)
  if (injection !== undefined) {
    return fail("trusted-field", injection, "Client proposal contains an authority-owned field")
  }
  if (hasUnknownCommandKind(input)) {
    return fail("message-kind-mismatch", "command", "Command kind is not supported")
  }
  const wire = readProposedWire(input)
  if (Option.isNone(wire)) return fail("malformed-message", "change", "Proposed change is malformed")
  const { kind: _kind, schemaVersion: _schemaVersion, ...change } = wire.value
  return decoded(change)
}

const decodeAccepted = (input: Schema.Json): DecodeResult<AcceptedCanvasChange> => {
  const header = preflight(input, "accepted-canvas-change")
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const wire = readAcceptedWire(input)
  return Option.isNone(wire)
    ? fail("malformed-message", "change", "Accepted change is malformed")
    : decoded(stripAccepted(wire.value))
}

const decodePage = (input: Schema.Json): DecodeResult<ChangePage> => {
  const header = preflight(input, "canvas-change-page")
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const root = readRecord(input)
  if (Option.isSome(root) && root.value.changes !== undefined) {
    const changes = readArray(root.value.changes)
    if (Option.isSome(changes)) {
      for (const change of changes.value) {
        const nested = decodeAccepted(change)
        if (Result.isFailure(nested)) return Result.fail(nested.failure)
      }
    }
  }
  const wire = readPageWire(input)
  if (Option.isNone(wire)) return fail("malformed-message", "message", "Change page is malformed")
  const { kind: _kind, schemaVersion: _schemaVersion, changes, ...page } = wire.value
  return decoded({ ...page, changes: changes.map(stripAccepted) })
}

const decodeReceipt = (input: Schema.Json): DecodeResult<SubmitChangeReceipt> => {
  const header = preflight(input, "submit-change-receipt")
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const root = readRecord(input)
  if (Option.isSome(root) && root.value.change !== undefined) {
    const nested = decodeAccepted(root.value.change)
    if (Result.isFailure(nested)) return Result.fail(nested.failure)
  }
  const wire = readReceiptWire(input)
  if (Option.isNone(wire)) return fail("malformed-message", "message", "Submit receipt is malformed")
  const { kind: _kind, schemaVersion: _schemaVersion, disposition, change } = wire.value
  return decoded({ disposition, change: stripAccepted(change) })
}

const decodeFailure = (input: Schema.Json): DecodeResult<ProtocolFailure> => {
  const header = preflight(input, "protocol-failure")
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const wire = readFailureWire(input)
  return Option.isNone(wire)
    ? fail("malformed-message", "message", "Protocol failure is malformed")
    : decoded(wire.value.failure)
}

export const ChangeProtocol = {
  proposed: {
    decode: decodeProposed,
    encode: (value: ProposedCanvasChange): Schema.Json =>
      Schema.encodeSync(ProposedWire)({ kind: "proposed-canvas-change", schemaVersion: 2, ...value })
  },
  accepted: {
    decode: decodeAccepted,
    encode: (value: AcceptedCanvasChange): Schema.Json =>
      Schema.encodeSync(AcceptedWire)({ kind: "accepted-canvas-change", schemaVersion: 2, ...value })
  },
  page: {
    decode: decodePage,
    encode: (value: ChangePage): Schema.Json => Schema.encodeSync(PageWire)({
      kind: "canvas-change-page",
      schemaVersion: 2,
      ...value,
      changes: value.changes.map(toAcceptedWire)
    })
  },
  receipt: {
    decode: decodeReceipt,
    encode: (value: SubmitChangeReceipt): Schema.Json => Schema.encodeSync(ReceiptWire)({
      kind: "submit-change-receipt",
      schemaVersion: 2,
      disposition: value.disposition,
      change: { kind: "accepted-canvas-change", schemaVersion: 2, ...value.change }
    })
  },
  failure: {
    decode: decodeFailure,
    encode: (value: ProtocolFailure): Schema.Json =>
      Schema.encodeSync(FailureWire)({ kind: "protocol-failure", schemaVersion: 1, failure: value })
  }
}
