import {
  AgentPrincipal,
  CanvasId,
  ExecutionId,
  PersonPrincipal,
  ReportedRuntime
} from "@crit/domain"
import { Data, Option, Result, Schema } from "effect"

import type { ProposedCanvasChange } from "./change.js"
import { ChangeProtocol } from "./codec.js"
import type { ProtocolFailure } from "./failure.js"
import { encodeQuery, queryParam } from "./query.js"
import { CursorSchema } from "./value.js"

export const remoteChangesPageLimit = 1_000
export const remoteCanvasCollectionPath = "/canvas"

export const PersonSubmitInvocation = Schema.TaggedStruct("person", {
  principal: PersonPrincipal
})
export type PersonSubmitInvocation = typeof PersonSubmitInvocation.Type

export const AgentSubmitInvocation = Schema.TaggedStruct("agent", {
  principal: AgentPrincipal,
  executionId: ExecutionId,
  reportedRuntime: Schema.optionalKey(ReportedRuntime)
})
export type AgentSubmitInvocation = typeof AgentSubmitInvocation.Type

export const SubmitInvocation = Schema.Union([
  PersonSubmitInvocation,
  AgentSubmitInvocation
])
export type SubmitInvocation = typeof SubmitInvocation.Type

export const SubmitCanvasChangeWire = Schema.Struct({
  kind: Schema.Literal("submit-canvas-change"),
  schemaVersion: Schema.Literal(1),
  invocation: SubmitInvocation,
  change: Schema.Json
})
export type SubmitCanvasChangeWire = typeof SubmitCanvasChangeWire.Type

export interface SubmitCanvasChange {
  readonly invocation: SubmitInvocation
  readonly proposal: ProposedCanvasChange
}

export const SubmitCanvasChangeEnvelopeInvalid = Schema.TaggedStruct(
  "envelopeInvalid",
  {}
)
export type SubmitCanvasChangeEnvelopeInvalid =
  typeof SubmitCanvasChangeEnvelopeInvalid.Type

export type SubmitCanvasChangeDecodeFailure =
  | SubmitCanvasChangeEnvelopeInvalid
  | ProtocolFailure

export type RemoteAuthorityRoute = Data.TaggedEnum<{
  readonly canvas: { readonly canvasId: CanvasId }
  readonly changes: { readonly canvasId: CanvasId }
}>
export const RemoteAuthorityRoute = Data.taggedEnum<RemoteAuthorityRoute>()

const ChangesAfterQuery = Schema.Struct({
  after: Schema.NullOr(CursorSchema),
  limit: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(remoteChangesPageLimit)
  )
})
export type ChangesAfterQuery = typeof ChangesAfterQuery.Type

const canvasIdFromPath = (raw: string): CanvasId | undefined => {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(CanvasId)(decoded))
}

export const parseRemoteAuthorityPath = (
  pathname: string
): RemoteAuthorityRoute | undefined => {
  const match = /^\/canvas\/([^/]+)(?:\/(changes))?$/.exec(pathname)
  if (match === null) return undefined
  const canvasId = canvasIdFromPath(match[1] ?? "")
  if (canvasId === undefined) return undefined
  return match[2] === "changes"
    ? RemoteAuthorityRoute.changes({ canvasId })
    : RemoteAuthorityRoute.canvas({ canvasId })
}

export const remoteCanvasPath = (canvasId: CanvasId): string =>
  `${remoteCanvasCollectionPath}/${encodeURIComponent(canvasId)}`

export const remoteCanvasChangesPath = (canvasId: CanvasId): string =>
  `${remoteCanvasPath(canvasId)}/changes`

export const parseChangesAfterSearch = (
  search: string
): ChangesAfterQuery | undefined => {
  const afterRaw = queryParam(search, "after")
  const limitRaw = queryParam(search, "limit")
  if (limitRaw !== null && !/^[1-9][0-9]*$/.test(limitRaw)) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(ChangesAfterQuery)({
    after: afterRaw === null || afterRaw === "" ? null : afterRaw,
    limit: limitRaw === null ? remoteChangesPageLimit : Number(limitRaw)
  }))
}

export const encodeChangesAfterSearch = (query: ChangesAfterQuery): string => {
  const entries: Array<readonly [string, string]> = []
  if (query.after !== null) entries.push(["after", query.after])
  entries.push(["limit", String(query.limit)])
  return encodeQuery(entries)
}

export const decodeSubmitCanvasChangeWire = (
  input: Schema.Json
): Result.Result<SubmitCanvasChange, SubmitCanvasChangeDecodeFailure> => {
  const wire = Schema.decodeUnknownOption(
    SubmitCanvasChangeWire,
    { onExcessProperty: "error" }
  )(input)
  if (Option.isNone(wire)) {
    return Result.fail(SubmitCanvasChangeEnvelopeInvalid.make({}))
  }
  const proposal = ChangeProtocol.proposed.decode(wire.value.change)
  if (Result.isFailure(proposal)) return Result.fail(proposal.failure)
  return Result.succeed({
    invocation: wire.value.invocation,
    proposal: proposal.success
  })
}

export const encodeSubmitCanvasChangeWire = (
  input: SubmitCanvasChange
): typeof SubmitCanvasChangeWire.Encoded => Schema.encodeUnknownSync(
  SubmitCanvasChangeWire,
  { onExcessProperty: "error" }
)({
  kind: "submit-canvas-change",
  schemaVersion: 1,
  invocation: input.invocation,
  change: ChangeProtocol.proposed.encode(input.proposal)
})
