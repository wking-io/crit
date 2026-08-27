import { Option, Predicate, Result, Schema, SchemaAST } from "effect"

import type {
  AcceptedCanvasChange,
  ChangePage,
  ProposedCanvasChange,
  SubmitChangeReceipt
} from "./change.js"
import { ProtocolFailure, type DecodeResult } from "./failure.js"
import { negotiateWire } from "./negotiate.js"
import {
  AcceptedWire,
  FailureWire,
  PageWire,
  ProposedWire,
  ReceiptWire
} from "./wire.js"

const CommandHeader = Schema.Struct({ _tag: Schema.String })
const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const JsonArray = Schema.Array(Schema.Json)
const exact: SchemaAST.ParseOptions = { onExcessProperty: "error" }
const readCommandHeader = Schema.decodeUnknownOption(CommandHeader)
const readRecord = Schema.decodeUnknownOption(JsonRecord, exact)
const readArray = Schema.decodeUnknownOption(JsonArray, exact)
const readProposedWire = Schema.decodeUnknownOption(ProposedWire, exact)
const readAcceptedWire = Schema.decodeUnknownOption(AcceptedWire, exact)
const readPageWire = Schema.decodeUnknownOption(PageWire, exact)
const readReceiptWire = Schema.decodeUnknownOption(ReceiptWire, exact)
const readFailureWire = Schema.decodeUnknownOption(FailureWire, exact)

const fail = (
  tag: Exclude<ProtocolFailure["_tag"], "unsupportedVersion">,
  location: ProtocolFailure["location"],
  message: string
): DecodeResult<never> => Result.fail(ProtocolFailure[tag]({ location, message }))

const decoded = <A>(value: A): DecodeResult<A> => Result.succeed(value)

const preflight = (
  input: Schema.Json,
  expectedKind: string,
  expectedVersion: number
): DecodeResult<Schema.Json> => {
  const negotiated = negotiateWire(input, {
    kind: expectedKind,
    schemaVersion: expectedVersion
  })
  return Result.isFailure(negotiated) ? Result.fail(negotiated.failure) : decoded(input)
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
    if (Option.isSome(header) && !(
      Predicate.isTagged(header.value, "renameCanvas") ||
      Predicate.isTagged(header.value, "addFrame") ||
      Predicate.isTagged(header.value, "setFrameTitle") ||
      Predicate.isTagged(header.value, "setFrameRepresentation") ||
      Predicate.isTagged(header.value, "setFrameStatus") ||
      Predicate.isTagged(header.value, "setFrameGeometry") ||
      Predicate.isTagged(header.value, "removeFrame") ||
      Predicate.isTagged(header.value, "placeCanvasItem")
    )) return true
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
  const header = preflight(input, "proposed-canvas-change", 2)
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const injection = injectedField(input)
  if (injection !== undefined) {
    return fail("trustedField", injection, "Client proposal contains an authority-owned field")
  }
  if (hasUnknownCommandKind(input)) {
    return fail("messageKindMismatch", "command", "Command kind is not supported")
  }
  const wire = readProposedWire(input)
  if (Option.isNone(wire)) return fail("malformedMessage", "change", "Proposed change is malformed")
  const { kind: _kind, schemaVersion: _schemaVersion, ...change } = wire.value
  return decoded(change)
}

const decodeAccepted = (input: Schema.Json): DecodeResult<AcceptedCanvasChange> => {
  const header = preflight(input, "accepted-canvas-change", 2)
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const wire = readAcceptedWire(input)
  return Option.isNone(wire)
    ? fail("malformedMessage", "change", "Accepted change is malformed")
    : decoded(stripAccepted(wire.value))
}

const decodePage = (input: Schema.Json): DecodeResult<ChangePage> => {
  const header = preflight(input, "canvas-change-page", 2)
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
  if (Option.isNone(wire)) return fail("malformedMessage", "message", "Change page is malformed")
  const { kind: _kind, schemaVersion: _schemaVersion, changes, ...page } = wire.value
  return decoded({ ...page, changes: changes.map(stripAccepted) })
}

const decodeReceipt = (input: Schema.Json): DecodeResult<SubmitChangeReceipt> => {
  const header = preflight(input, "submit-change-receipt", 2)
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const root = readRecord(input)
  if (Option.isSome(root) && root.value.change !== undefined) {
    const nested = decodeAccepted(root.value.change)
    if (Result.isFailure(nested)) return Result.fail(nested.failure)
  }
  const wire = readReceiptWire(input)
  if (Option.isNone(wire)) return fail("malformedMessage", "message", "Submit receipt is malformed")
  const { kind: _kind, schemaVersion: _schemaVersion, disposition, change } = wire.value
  return decoded({ disposition, change: stripAccepted(change) })
}

const decodeFailure = (input: Schema.Json): DecodeResult<ProtocolFailure> => {
  const header = preflight(input, "protocol-failure", 1)
  if (Result.isFailure(header)) return Result.fail(header.failure)
  const wire = readFailureWire(input)
  return Option.isNone(wire)
    ? fail("malformedMessage", "message", "Protocol failure is malformed")
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
