import {
  AcceptedAttribution,
  AgentPrincipal,
  CanvasChangeFailureSchema,
  CanvasId,
  CanvasProjection,
  CanvasTitle,
  ChangeId,
  ExecutionId,
  IsoTimestamp,
  PersonPrincipal,
  ReportedRuntime
} from "@crit/domain"
import type {
  ChangePage,
  Cursor,
  ProposedCanvasChange,
  SubmitChangeReceipt
} from "@crit/protocol"
import { ProtocolValue } from "@crit/protocol"
import { Context, type Effect, Schema } from "effect"

const CursorValue = Schema.declare<Cursor>((input): input is Cursor => {
  try {
    ProtocolValue.cursor(input)
    return true
  } catch {
    return false
  }
})

export const PageLimit = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(1_000)
).pipe(Schema.brand("PageLimit"))
export type PageLimit = typeof PageLimit.Type

export const CreateCanvas = Schema.TaggedStruct("create-canvas", {
  canvasId: CanvasId,
  title: CanvasTitle
})
export type CreateCanvas = typeof CreateCanvas.Type

export const PersonInvocation = Schema.TaggedStruct("person", {
  principal: PersonPrincipal
})
export type PersonInvocation = typeof PersonInvocation.Type

export const AgentInvocation = Schema.TaggedStruct("agent", {
  principal: AgentPrincipal,
  executionId: ExecutionId,
  reportedRuntime: Schema.optionalKey(ReportedRuntime)
})
export type AgentInvocation = typeof AgentInvocation.Type

export const VerifiedInvocation = Schema.Union([
  PersonInvocation,
  AgentInvocation
])
export type VerifiedInvocation = typeof VerifiedInvocation.Type

export const AuthorityView = Schema.TaggedStruct("authority-view", {
  canvasId: CanvasId,
  createdAt: IsoTimestamp,
  createdBy: AcceptedAttribution,
  cursor: CursorValue,
  projection: CanvasProjection
})
export type AuthorityView = typeof AuthorityView.Type

export const ChangesAfter = Schema.TaggedStruct("changes-after", {
  canvasId: CanvasId,
  after: Schema.NullOr(CursorValue),
  limit: PageLimit
})
export type ChangesAfter = typeof ChangesAfter.Type

export const CanvasNotFound = Schema.TaggedStruct("canvas-not-found", {
  canvasId: CanvasId
})
export type CanvasNotFound = typeof CanvasNotFound.Type

export const CanvasAlreadyExists = Schema.TaggedStruct("canvas-already-exists", {
  canvasId: CanvasId
})
export type CanvasAlreadyExists = typeof CanvasAlreadyExists.Type

export const CursorNotFound = Schema.TaggedStruct("cursor-not-found", {
  canvasId: CanvasId,
  cursor: CursorValue
})
export type CursorNotFound = typeof CursorNotFound.Type

export const ChangeIdReused = Schema.TaggedStruct("change-id-reused", {
  canvasId: CanvasId,
  changeId: ChangeId
})
export type ChangeIdReused = typeof ChangeIdReused.Type

export const ChangeRejected = Schema.TaggedStruct("change-rejected", {
  canvasId: CanvasId,
  changeId: ChangeId,
  failure: CanvasChangeFailureSchema
})
export type ChangeRejected = typeof ChangeRejected.Type

export type CreateCanvasFailure = CanvasAlreadyExists
export type OpenCanvasFailure = CanvasNotFound
export type SubmitCanvasChangeFailure = CanvasNotFound | CursorNotFound | ChangeIdReused | ChangeRejected
export type ChangesAfterFailure = CanvasNotFound | CursorNotFound

export class CanvasAuthority extends Context.Service<CanvasAuthority, {
  readonly create: (
    command: CreateCanvas,
    invocation: VerifiedInvocation
  ) => Effect.Effect<AuthorityView, CreateCanvasFailure>
  readonly open: (
    canvasId: CanvasId
  ) => Effect.Effect<AuthorityView, OpenCanvasFailure>
  readonly submit: (
    proposal: ProposedCanvasChange,
    invocation: VerifiedInvocation
  ) => Effect.Effect<SubmitChangeReceipt, SubmitCanvasChangeFailure>
  readonly changesAfter: (
    query: ChangesAfter
  ) => Effect.Effect<ChangePage, ChangesAfterFailure>
}>()("@crit/authority/CanvasAuthority") {}

export const AuthorityModel = {
  createCanvas: CreateCanvas.make,
  personInvocation: PersonInvocation.make,
  agentInvocation: AgentInvocation.make,
  changesAfter: ChangesAfter.make,
  pageLimit: Schema.decodeUnknownSync(PageLimit)
}

export const AuthorityFailure = {
  canvasNotFound: CanvasNotFound.make,
  canvasAlreadyExists: CanvasAlreadyExists.make,
  cursorNotFound: CursorNotFound.make,
  changeIdReused: ChangeIdReused.make,
  changeRejected: ChangeRejected.make
}
