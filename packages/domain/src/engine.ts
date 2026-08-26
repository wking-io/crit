import { Data, Match, Predicate, Schema } from "effect"

import { CanvasProjection, CanvasTitle } from "./canvas.js"
import { FrameItemRef, type AuthoredText, type CanvasItemRef, type Frame, type ReviewStatus } from "./content.js"
import type { CanvasChange, CanvasCommand, CanvasCommandBatch } from "./command.js"
import { compareCanonicalId } from "./canonical-order.js"
import type { Geometry } from "./geometry.js"
import { CanvasId, ChangeId, type FrameId } from "./ids.js"
import type { RepresentationRef } from "./representation.js"

const CommandIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const EntityKind = Schema.Literal("frame")
const PreconditionValue = Schema.Union([Schema.String, Schema.Boolean, Schema.Null])
const CanvasMismatch = Schema.TaggedStruct("canvas-mismatch", { expectedCanvasId: CanvasId, actualCanvasId: CanvasId })
const CanvasTitleMismatch = Schema.TaggedStruct("canvas-title-mismatch", { commandIndex: CommandIndex, expectedTitle: CanvasTitle, actualTitle: CanvasTitle })
const EntityNotFound = Schema.TaggedStruct("entity-not-found", { commandIndex: CommandIndex, entity: EntityKind, id: Schema.String })
const IdAlreadyIssued = Schema.TaggedStruct("id-already-issued", { commandIndex: CommandIndex, entity: EntityKind, id: Schema.String })
const PreconditionFailed = Schema.TaggedStruct("precondition-failed", { commandIndex: CommandIndex, field: Schema.String, expected: PreconditionValue, actual: PreconditionValue })
const InvalidReference = Schema.TaggedStruct("invalid-reference", { commandIndex: CommandIndex, field: Schema.String, id: Schema.String })
export const CanvasChangeFailureSchema = Schema.Union([
  CanvasMismatch,
  CanvasTitleMismatch,
  EntityNotFound,
  IdAlreadyIssued,
  PreconditionFailed,
  InvalidReference
])
export type CanvasChangeFailure = typeof CanvasChangeFailureSchema.Type

const CanvasProjectionValue = Schema.declare<CanvasProjection>(Schema.is(CanvasProjection))
const Applied = Schema.TaggedStruct("applied", { projection: CanvasProjectionValue })
const Rejected = Schema.TaggedStruct("rejected", { failure: CanvasChangeFailureSchema })
const CanvasChangeResultSchema = Schema.Union([Applied, Rejected])
export type CanvasChangeResult = typeof CanvasChangeResultSchema.Type

const DuplicateChange = Schema.TaggedStruct("duplicate-change", { changeId: ChangeId, firstIndex: CommandIndex, currentIndex: CommandIndex })
const ChangeRejected = Schema.TaggedStruct("change-rejected", { changeIndex: CommandIndex, changeId: ChangeId, failure: CanvasChangeFailureSchema })
const CanvasReplayFailureSchema = Schema.Union([DuplicateChange, ChangeRejected])
export type CanvasReplayFailure = typeof CanvasReplayFailureSchema.Type

const Replayed = Schema.TaggedStruct("replayed", { projection: CanvasProjectionValue })
const ReplayFailed = Schema.TaggedStruct("replay-failed", { failure: CanvasReplayFailureSchema })
const CanvasReplayResultSchema = Schema.Union([Replayed, ReplayFailed])
export type CanvasReplayResult = typeof CanvasReplayResultSchema.Type

const trusted = { disableChecks: true } as const
const applied = (projection: CanvasProjection): CanvasChangeResult => Applied.make({ projection }, trusted)
const reject = (failure: CanvasChangeFailure): CanvasChangeResult => Rejected.make({ failure }, trusted)
const itemKey = (item: CanvasItemRef) => `frame:${item.frameId}`
const insertSorted = <A extends string>(values: readonly A[], value: A): readonly A[] => [...values, value].sort(compareCanonicalId)
const findFrame = (p: CanvasProjection, id: string) => p.frames.find((value) => value.frameId === id)
const entityFailure = (commandIndex: number, entity: typeof EntityKind.Type, id: string, issued: boolean) =>
  reject(issued ? IdAlreadyIssued.make({ commandIndex, entity, id }, trusted) : EntityNotFound.make({ commandIndex, entity, id }, trusted))
const precondition = (commandIndex: number, field: string, expected: string | boolean | null, actual: string | boolean | null) =>
  reject(PreconditionFailed.make({ commandIndex, field, expected, actual }, trusted))
const replaceById = <A>(values: readonly A[], predicate: (value: A) => boolean, replacement: A): readonly A[] =>
  values.map((value) => predicate(value) ? replacement : value)
const geometryEquals = (left: Geometry, right: Geometry): boolean =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
const jsonEquals = (left: Schema.Json | undefined, right: Schema.Json | undefined): boolean => {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => jsonEquals(value, right[index]))
  }
  if (
    Array.isArray(left) || Array.isArray(right) || Predicate.isNullish(left) || Predicate.isNullish(right) ||
    Predicate.isString(left) || Predicate.isString(right) || Predicate.isNumber(left) || Predicate.isNumber(right) ||
    Predicate.isBoolean(left) || Predicate.isBoolean(right)
  ) return false
  const leftEntries = Object.entries(left).sort(([a], [b]) => compareCanonicalId(a, b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => compareCanonicalId(a, b))
  return leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && jsonEquals(value, rightEntries[index]?.[1]))
}
const representationEquals = (left: RepresentationRef, right: RepresentationRef): boolean => {
  if (left._tag !== right._tag) return false
  switch (left._tag) {
    case "application-route":
      return right._tag === "application-route" &&
        left.applicationId === right.applicationId &&
        left.route === right.route &&
        jsonEquals(left.state, right.state)
    case "web-url":
      return right._tag === "web-url" && left.url === right.url
    case "artifact":
      return right._tag === "artifact" && left.artifactId === right.artifactId && left.digest === right.digest
  }
}
const stackEquals = (left: readonly CanvasItemRef[], right: readonly CanvasItemRef[]): boolean =>
  left.length === right.length && left.every((item, index) => right[index] !== undefined && itemKey(item) === itemKey(right[index]!))

type CanvasAggregateCommand = Extract<CanvasCommand, { readonly _tag: "rename-canvas" }>
type WireFrameCommand = Extract<CanvasCommand, {
  readonly _tag: "add-frame" | "set-frame-title" | "set-frame-representation" | "set-frame-status" | "set-frame-geometry" | "remove-frame"
}>
type StackAggregateCommand = Extract<CanvasCommand, { readonly _tag: "place-canvas-item" }>

type FrameAggregateCommand = Data.TaggedEnum<{
  readonly addFrame: {
    readonly frameId: FrameId
    readonly title: AuthoredText
    readonly representation: RepresentationRef
    readonly status: ReviewStatus
    readonly geometry: Geometry
  }
  readonly setFrameTitle: {
    readonly frameId: FrameId
    readonly expectedChangedByChangeId: ChangeId
    readonly title: AuthoredText
  }
  readonly setFrameRepresentation: {
    readonly frameId: FrameId
    readonly expectedChangedByChangeId: ChangeId
    readonly representation: RepresentationRef
  }
  readonly setFrameStatus: {
    readonly frameId: FrameId
    readonly expectedChangedByChangeId: ChangeId
    readonly status: ReviewStatus
  }
  readonly setFrameGeometry: {
    readonly frameId: FrameId
    readonly expectedChangedByChangeId: ChangeId
    readonly geometry: Geometry
  }
  readonly removeFrame: {
    readonly frameId: FrameId
    readonly expectedUpdatedByChangeId: ChangeId
  }
}>
const FrameAggregateCommand = Data.taggedEnum<FrameAggregateCommand>()

const toFrameAggregateCommand = Match.type<WireFrameCommand>().pipe(Match.tagsExhaustive({
  "add-frame": ({ frameId, title, representation, status, geometry }) =>
    FrameAggregateCommand.addFrame({ frameId, title, representation, status, geometry }),
  "set-frame-title": ({ frameId, expectedChangedByChangeId, title }) =>
    FrameAggregateCommand.setFrameTitle({ frameId, expectedChangedByChangeId, title }),
  "set-frame-representation": ({ frameId, expectedChangedByChangeId, representation }) =>
    FrameAggregateCommand.setFrameRepresentation({ frameId, expectedChangedByChangeId, representation }),
  "set-frame-status": ({ frameId, expectedChangedByChangeId, status }) =>
    FrameAggregateCommand.setFrameStatus({ frameId, expectedChangedByChangeId, status }),
  "set-frame-geometry": ({ frameId, expectedChangedByChangeId, geometry }) =>
    FrameAggregateCommand.setFrameGeometry({ frameId, expectedChangedByChangeId, geometry }),
  "remove-frame": ({ frameId, expectedUpdatedByChangeId }) =>
    FrameAggregateCommand.removeFrame({ frameId, expectedUpdatedByChangeId })
}))

const applyCanvasCommand = (p: CanvasProjection, c: CanvasAggregateCommand, commandIndex: number): CanvasChangeResult => {
  switch (c._tag) {
    case "rename-canvas":
      if (p.title !== c.expectedTitle) {
        return reject(CanvasTitleMismatch.make({
          commandIndex,
          expectedTitle: c.expectedTitle,
          actualTitle: p.title
        }, trusted))
      }
      return applied(p.title === c.title ? p : { ...p, title: c.title })
  }
}

const applyAddFrame = (
  p: CanvasProjection,
  c: Extract<FrameAggregateCommand, { readonly _tag: "addFrame" }>,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  if (p.issuedIds.frameIds.includes(c.frameId)) return entityFailure(commandIndex, "frame", c.frameId, true)
  const frame: Frame = {
    frameId: c.frameId,
    title: c.title,
    representation: c.representation,
    status: c.status,
    geometry: c.geometry,
    createdByChangeId: changeId,
    updatedByChangeId: changeId,
    titleChangedByChangeId: changeId,
    representationChangedByChangeId: changeId,
    statusChangedByChangeId: changeId,
    geometryChangedByChangeId: changeId
  }
  return applied({
    ...p,
    frames: [...p.frames, frame].sort((a, b) => compareCanonicalId(a.frameId, b.frameId)),
    stack: [...p.stack, FrameItemRef.make({ frameId: c.frameId }, trusted)],
    stackChangedByChangeId: changeId,
    issuedIds: { frameIds: insertSorted(p.issuedIds.frameIds, c.frameId) }
  })
}

const applySetFrameTitle = (
  p: CanvasProjection,
  c: Extract<FrameAggregateCommand, { readonly _tag: "setFrameTitle" }>,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  const frame = findFrame(p, c.frameId)
  if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
  if (frame.titleChangedByChangeId !== c.expectedChangedByChangeId) {
    return precondition(commandIndex, "titleChangedByChangeId", c.expectedChangedByChangeId, frame.titleChangedByChangeId)
  }
  if (frame.title === c.title) return applied(p)
  const next = { ...frame, title: c.title, titleChangedByChangeId: changeId, updatedByChangeId: changeId }
  return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
}

const applySetFrameRepresentation = (
  p: CanvasProjection,
  c: Extract<FrameAggregateCommand, { readonly _tag: "setFrameRepresentation" }>,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  const frame = findFrame(p, c.frameId)
  if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
  if (frame.representationChangedByChangeId !== c.expectedChangedByChangeId) {
    return precondition(
      commandIndex,
      "representationChangedByChangeId",
      c.expectedChangedByChangeId,
      frame.representationChangedByChangeId
    )
  }
  if (representationEquals(frame.representation, c.representation)) return applied(p)
  const next = {
    ...frame,
    representation: c.representation,
    representationChangedByChangeId: changeId,
    updatedByChangeId: changeId
  }
  return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
}

const applySetFrameStatus = (
  p: CanvasProjection,
  c: Extract<FrameAggregateCommand, { readonly _tag: "setFrameStatus" }>,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  const frame = findFrame(p, c.frameId)
  if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
  if (frame.statusChangedByChangeId !== c.expectedChangedByChangeId) {
    return precondition(commandIndex, "statusChangedByChangeId", c.expectedChangedByChangeId, frame.statusChangedByChangeId)
  }
  if (frame.status === c.status) return applied(p)
  const next = { ...frame, status: c.status, statusChangedByChangeId: changeId, updatedByChangeId: changeId }
  return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
}

const applySetFrameGeometry = (
  p: CanvasProjection,
  c: Extract<FrameAggregateCommand, { readonly _tag: "setFrameGeometry" }>,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  const frame = findFrame(p, c.frameId)
  if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
  if (frame.geometryChangedByChangeId !== c.expectedChangedByChangeId) {
    return precondition(commandIndex, "geometryChangedByChangeId", c.expectedChangedByChangeId, frame.geometryChangedByChangeId)
  }
  if (geometryEquals(frame.geometry, c.geometry)) return applied(p)
  const next = { ...frame, geometry: c.geometry, geometryChangedByChangeId: changeId, updatedByChangeId: changeId }
  return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
}

const applyRemoveFrame = (
  p: CanvasProjection,
  c: Extract<FrameAggregateCommand, { readonly _tag: "removeFrame" }>,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  const frame = findFrame(p, c.frameId)
  if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
  if (frame.updatedByChangeId !== c.expectedUpdatedByChangeId) {
    return precondition(commandIndex, "updatedByChangeId", c.expectedUpdatedByChangeId, frame.updatedByChangeId)
  }
  return applied({
    ...p,
    frames: p.frames.filter((value) => value.frameId !== c.frameId),
    stack: p.stack.filter((item) => item.frameId !== c.frameId),
    stackChangedByChangeId: changeId
  })
}

const applyFrameCommand = (
  p: CanvasProjection,
  c: FrameAggregateCommand,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult =>
  Match.value(c).pipe(Match.tagsExhaustive({
    addFrame: (command) => applyAddFrame(p, command, commandIndex, changeId),
    setFrameTitle: (command) => applySetFrameTitle(p, command, commandIndex, changeId),
    setFrameRepresentation: (command) => applySetFrameRepresentation(p, command, commandIndex, changeId),
    setFrameStatus: (command) => applySetFrameStatus(p, command, commandIndex, changeId),
    setFrameGeometry: (command) => applySetFrameGeometry(p, command, commandIndex, changeId),
    removeFrame: (command) => applyRemoveFrame(p, command, commandIndex, changeId)
  }))

const applyStackCommand = (
  p: CanvasProjection,
  c: StackAggregateCommand,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  switch (c._tag) {
    case "place-canvas-item": {
      if (p.stackChangedByChangeId !== c.expectedStackChangeId) {
        return precondition(commandIndex, "stackChangedByChangeId", c.expectedStackChangeId, p.stackChangedByChangeId)
      }
      const key = itemKey(c.item)
      if (!p.stack.some((item) => itemKey(item) === key)) {
        return reject(InvalidReference.make({ commandIndex, field: "item", id: key }, trusted))
      }
      const without = p.stack.filter((item) => itemKey(item) !== key)
      let index = 0
      if (c.after !== null) {
        const afterKey = itemKey(c.after)
        if (afterKey === key) return reject(InvalidReference.make({ commandIndex, field: "after", id: afterKey }, trusted))
        const afterIndex = without.findIndex((item) => itemKey(item) === afterKey)
        if (afterIndex < 0) return reject(InvalidReference.make({ commandIndex, field: "after", id: afterKey }, trusted))
        index = afterIndex + 1
      }
      const stack = [...without.slice(0, index), c.item, ...without.slice(index)]
      return applied(stackEquals(stack, p.stack) ? p : { ...p, stack, stackChangedByChangeId: changeId })
    }
  }
}

const applyCommand = (
  p: CanvasProjection,
  c: CanvasCommand,
  commandIndex: number,
  changeId: ChangeId
): CanvasChangeResult => {
  switch (c._tag) {
    case "rename-canvas":
      return applyCanvasCommand(p, c, commandIndex)
    case "add-frame":
    case "set-frame-title":
    case "set-frame-representation":
    case "set-frame-status":
    case "set-frame-geometry":
    case "remove-frame":
      return applyFrameCommand(p, toFrameAggregateCommand(c), commandIndex, changeId)
    case "place-canvas-item":
      return applyStackCommand(p, c, commandIndex, changeId)
  }
}

const applyCommands = (
  initial: CanvasProjection,
  commands: CanvasCommandBatch,
  changeId: ChangeId
): CanvasChangeResult => {
  let projection = initial
  for (const [commandIndex, command] of commands.entries()) {
    const result = applyCommand(projection, command, commandIndex, changeId)
    if (result._tag === "rejected") return result
    projection = result.projection
  }
  return applied(projection)
}

const apply = (projection: CanvasProjection, change: CanvasChange): CanvasChangeResult =>
  projection.canvasId !== change.canvasId
    ? reject(CanvasMismatch.make({
      expectedCanvasId: projection.canvasId,
      actualCanvasId: change.canvasId
    }, trusted))
    : applyCommands(projection, change.commands, change.changeId)

const replay = (initial: CanvasProjection, changes: readonly CanvasChange[]): CanvasReplayResult => {
  let projection = initial
  const seen = new Map<ChangeId, number>()
  for (const [changeIndex, change] of changes.entries()) {
    const firstIndex = seen.get(change.changeId)
    if (firstIndex !== undefined) {
      return ReplayFailed.make({
        failure: DuplicateChange.make({ changeId: change.changeId, firstIndex, currentIndex: changeIndex }, trusted)
      }, trusted)
    }
    const result = apply(projection, change)
    if (result._tag === "rejected") {
      return ReplayFailed.make({
        failure: ChangeRejected.make({
          changeIndex,
          changeId: change.changeId,
          failure: result.failure
        }, trusted)
      }, trusted)
    }
    seen.set(change.changeId, changeIndex)
    projection = result.projection
  }
  return Replayed.make({ projection }, trusted)
}

export const CanvasEngine = { apply, replay }
