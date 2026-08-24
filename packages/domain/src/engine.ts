import { Predicate, Schema } from "effect"

import { CanvasProjection, CanvasTitle } from "./canvas.js"
import { FrameItemRef, NoteItemRef, type CanvasItemRef, type CommentThread, type Frame, type Note } from "./content.js"
import type { CanvasChange, CanvasCommand, CanvasCommandBatch } from "./command.js"
import { compareCanonicalId } from "./canonical-order.js"
import type { Geometry } from "./geometry.js"
import { actorFromAttribution } from "./identity.js"
import type { AcceptedAttribution, ActorSnapshot } from "./identity.js"
import { CanvasId, ChangeId, NoteId } from "./ids.js"
import type { RepresentationRef } from "./representation.js"

export type AuthoredEngineChange = CanvasChange & { readonly author: ActorSnapshot }

export const engineChange = (
  change: CanvasChange,
  author: ActorSnapshot
): AuthoredEngineChange => ({
  canvasId: change.canvasId,
  changeId: change.changeId,
  commands: change.commands,
  author
})

export const engineChangeFromAccepted = (change: CanvasChange & {
  readonly attribution: AcceptedAttribution
}): AuthoredEngineChange => engineChange(change, actorFromAttribution(change.attribution))

const CommandIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const EntityKind = Schema.Literals(["frame", "note", "thread", "comment"])
const PreconditionValue = Schema.Union([Schema.String, Schema.Boolean, Schema.Null])
const CanvasMismatch = Schema.TaggedStruct("canvas-mismatch", { expectedCanvasId: CanvasId, actualCanvasId: CanvasId })
const CanvasTitleMismatch = Schema.TaggedStruct("canvas-title-mismatch", { commandIndex: CommandIndex, expectedTitle: CanvasTitle, actualTitle: CanvasTitle })
const EntityNotFound = Schema.TaggedStruct("entity-not-found", { commandIndex: CommandIndex, entity: EntityKind, id: Schema.String })
const IdAlreadyIssued = Schema.TaggedStruct("id-already-issued", { commandIndex: CommandIndex, entity: EntityKind, id: Schema.String })
const PreconditionFailed = Schema.TaggedStruct("precondition-failed", { commandIndex: CommandIndex, field: Schema.String, expected: PreconditionValue, actual: PreconditionValue })
const InvalidReference = Schema.TaggedStruct("invalid-reference", { commandIndex: CommandIndex, field: Schema.String, id: Schema.String })
const DerivedGeometryInvalid = Schema.TaggedStruct("derived-geometry-invalid", { commandIndex: CommandIndex, noteId: NoteId })
export const CanvasChangeFailureSchema = Schema.Union([CanvasMismatch, CanvasTitleMismatch, EntityNotFound, IdAlreadyIssued, PreconditionFailed, InvalidReference, DerivedGeometryInvalid])
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
const itemKey = (item: CanvasItemRef) => item._tag === "frame" ? `frame:${item.frameId}` : `note:${item.noteId}`
const insertSorted = <A extends string>(values: readonly A[], value: A): readonly A[] => [...values, value].sort(compareCanonicalId)
const findFrame = (p: CanvasProjection, id: string) => p.frames.find((value) => value.frameId === id)
const findNote = (p: CanvasProjection, id: string) => p.notes.find((value) => value.noteId === id)
const findThread = (p: CanvasProjection, id: string) => p.threads.find((value) => value.threadId === id)
const entityFailure = (commandIndex: number, entity: typeof EntityKind.Type, id: string, issued: boolean) =>
  reject(issued ? IdAlreadyIssued.make({ commandIndex, entity, id }, trusted) : EntityNotFound.make({ commandIndex, entity, id }, trusted))
const precondition = (commandIndex: number, field: string, expected: string | boolean | null, actual: string | boolean | null) =>
  reject(PreconditionFailed.make({ commandIndex, field, expected, actual }, trusted))
const replaceById = <A>(values: readonly A[], predicate: (value: A) => boolean, replacement: A): readonly A[] => values.map((value) => predicate(value) ? replacement : value)
const appendNonEmpty = <A>(values: readonly [A, ...A[]], value: A): readonly [A, ...A[]] =>
  [values[0], ...values.slice(1), value]
const mapNonEmpty = <A>(values: readonly [A, ...A[]], transform: (value: A) => A): readonly [A, ...A[]] =>
  [transform(values[0]), ...values.slice(1).map(transform)]
const geometryEquals = (left: Geometry, right: Geometry): boolean =>
  left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
const jsonEquals = (left: Schema.Json | undefined, right: Schema.Json | undefined): boolean => {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => jsonEquals(value, right[index]))
  if (Array.isArray(left) || Array.isArray(right) || Predicate.isNullish(left) || Predicate.isNullish(right) ||
      Predicate.isString(left) || Predicate.isString(right) || Predicate.isNumber(left) || Predicate.isNumber(right) ||
      Predicate.isBoolean(left) || Predicate.isBoolean(right)) return false
  const leftEntries = Object.entries(left).sort(([a], [b]) => compareCanonicalId(a, b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => compareCanonicalId(a, b))
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && jsonEquals(value, rightEntries[index]?.[1]))
}
const representationEquals = (left: RepresentationRef, right: RepresentationRef): boolean => {
  if (left._tag !== right._tag) return false
  switch (left._tag) {
    case "application-route": return right._tag === "application-route" && left.applicationId === right.applicationId && left.route === right.route && jsonEquals(left.state, right.state)
    case "web-url": return right._tag === "web-url" && left.url === right.url
    case "artifact": return right._tag === "artifact" && left.artifactId === right.artifactId && left.digest === right.digest
  }
}
const stackEquals = (left: readonly CanvasItemRef[], right: readonly CanvasItemRef[]): boolean =>
  left.length === right.length && left.every((item, index) => right[index] !== undefined && itemKey(item) === itemKey(right[index]!))

type CanvasAggregateCommand = Extract<CanvasCommand, { readonly _tag: "rename-canvas" }>
type FrameAggregateCommand = Extract<CanvasCommand, { readonly _tag: "add-frame" | "set-frame-title" | "set-frame-representation" | "set-frame-status" | "set-frame-geometry" | "remove-frame" }>
type StackAggregateCommand = Extract<CanvasCommand, { readonly _tag: "place-canvas-item" }>
type NoteAggregateCommand = Extract<CanvasCommand, { readonly _tag: "add-note" | "edit-note" | "set-note-color" | "set-note-geometry" | "attach-note" | "detach-note" | "remove-note" }>
type CommentAggregateCommand = Extract<CanvasCommand, { readonly _tag: "add-comment-thread" | "reply-to-comment-thread" | "edit-comment" | "set-comment-thread-resolution" }>

const applyCanvasCommand = (p: CanvasProjection, c: CanvasAggregateCommand, commandIndex: number): CanvasChangeResult => {
  switch (c._tag) {
    case "rename-canvas":
      if (p.title !== c.expectedTitle) return reject(CanvasTitleMismatch.make({ commandIndex, expectedTitle: c.expectedTitle, actualTitle: p.title }, trusted))
      return applied(p.title === c.title ? p : { ...p, title: c.title })
  }
}

const applyFrameCommand = (p: CanvasProjection, c: FrameAggregateCommand, commandIndex: number, changeId: ChangeId): CanvasChangeResult => {
  switch (c._tag) {
    case "add-frame": {
      if (p.issuedIds.frameIds.includes(c.frameId)) return entityFailure(commandIndex, "frame", c.frameId, true)
      const frame: Frame = { frameId: c.frameId, title: c.title, representation: c.representation, status: c.status, geometry: c.geometry, createdByChangeId: changeId, updatedByChangeId: changeId, titleChangedByChangeId: changeId, representationChangedByChangeId: changeId, statusChangedByChangeId: changeId, geometryChangedByChangeId: changeId }
      return applied({ ...p, frames: [...p.frames, frame].sort((a, b) => compareCanonicalId(a.frameId, b.frameId)), stack: [...p.stack, FrameItemRef.make({ frameId: c.frameId }, trusted)], stackChangedByChangeId: changeId, issuedIds: { ...p.issuedIds, frameIds: insertSorted(p.issuedIds.frameIds, c.frameId) } })
    }
    case "set-frame-title": {
      const frame = findFrame(p, c.frameId)
      if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
      if (frame.titleChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "titleChangedByChangeId", c.expectedChangedByChangeId, frame.titleChangedByChangeId)
      if (frame.title === c.title) return applied(p)
      const next = { ...frame, title: c.title, titleChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
    }
    case "set-frame-representation": {
      const frame = findFrame(p, c.frameId)
      if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
      if (frame.representationChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "representationChangedByChangeId", c.expectedChangedByChangeId, frame.representationChangedByChangeId)
      if (representationEquals(frame.representation, c.representation)) return applied(p)
      const next = { ...frame, representation: c.representation, representationChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
    }
    case "set-frame-status": {
      const frame = findFrame(p, c.frameId)
      if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
      if (frame.statusChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "statusChangedByChangeId", c.expectedChangedByChangeId, frame.statusChangedByChangeId)
      if (frame.status === c.status) return applied(p)
      const next = { ...frame, status: c.status, statusChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next) })
    }
    case "set-frame-geometry": {
      const frame = findFrame(p, c.frameId)
      if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
      if (frame.geometryChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "geometryChangedByChangeId", c.expectedChangedByChangeId, frame.geometryChangedByChangeId)
      if (geometryEquals(frame.geometry, c.geometry)) return applied(p)
      const dx = c.geometry.x - frame.geometry.x
      const dy = c.geometry.y - frame.geometry.y
      let notes = p.notes
      if (dx !== 0 || dy !== 0) {
        const translated: Note[] = []
        for (const note of p.notes) {
          if (note.attachedFrameId !== frame.frameId) {
            translated.push(note)
            continue
          }
          const x = note.geometry.x + dx
          const y = note.geometry.y + dy
          if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(x) || !Number.isFinite(y)) {
            return reject(DerivedGeometryInvalid.make({ commandIndex, noteId: note.noteId }, trusted))
          }
          translated.push({ ...note, geometry: { ...note.geometry, x, y }, geometryChangedByChangeId: changeId, updatedByChangeId: changeId })
        }
        notes = translated
      }
      const next = { ...frame, geometry: c.geometry, geometryChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, frames: replaceById(p.frames, (value) => value.frameId === frame.frameId, next), notes })
    }
    case "remove-frame": {
      const frame = findFrame(p, c.frameId)
      if (frame === undefined) return entityFailure(commandIndex, "frame", c.frameId, false)
      if (frame.updatedByChangeId !== c.expectedUpdatedByChangeId) return precondition(commandIndex, "updatedByChangeId", c.expectedUpdatedByChangeId, frame.updatedByChangeId)
      return applied({ ...p, frames: p.frames.filter((value) => value.frameId !== c.frameId), notes: p.notes.map((note) => note.attachedFrameId === c.frameId ? { ...note, attachedFrameId: null, attachmentChangedByChangeId: changeId, updatedByChangeId: changeId } : note), threads: p.threads.filter((thread) => thread.anchor.frameId !== c.frameId), stack: p.stack.filter((item) => !(item._tag === "frame" && item.frameId === c.frameId)), stackChangedByChangeId: changeId })
    }
  }
}

const applyStackCommand = (p: CanvasProjection, c: StackAggregateCommand, commandIndex: number, changeId: ChangeId): CanvasChangeResult => {
  switch (c._tag) {
    case "place-canvas-item": {
      if (p.stackChangedByChangeId !== c.expectedStackChangeId) return precondition(commandIndex, "stackChangedByChangeId", c.expectedStackChangeId, p.stackChangedByChangeId)
      const key = itemKey(c.item)
      if (!p.stack.some((item) => itemKey(item) === key)) return reject(InvalidReference.make({ commandIndex, field: "item", id: key }, trusted))
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

const applyNoteCommand = (
  p: CanvasProjection,
  c: NoteAggregateCommand,
  commandIndex: number,
  changeId: ChangeId,
  author: ActorSnapshot
): CanvasChangeResult => {
  switch (c._tag) {
    case "add-note": {
      if (p.issuedIds.noteIds.includes(c.noteId)) return entityFailure(commandIndex, "note", c.noteId, true)
      if (c.attachedFrameId !== null && findFrame(p, c.attachedFrameId) === undefined) return reject(InvalidReference.make({ commandIndex, field: "attachedFrameId", id: c.attachedFrameId }, trusted))
      const note: Note = { noteId: c.noteId, text: c.text, author, color: c.color, geometry: c.geometry, attachedFrameId: c.attachedFrameId, createdByChangeId: changeId, updatedByChangeId: changeId, textChangedByChangeId: changeId, colorChangedByChangeId: changeId, geometryChangedByChangeId: changeId, attachmentChangedByChangeId: changeId }
      return applied({ ...p, notes: [...p.notes, note].sort((a, b) => compareCanonicalId(a.noteId, b.noteId)), stack: [...p.stack, NoteItemRef.make({ noteId: c.noteId }, trusted)], stackChangedByChangeId: changeId, issuedIds: { ...p.issuedIds, noteIds: insertSorted(p.issuedIds.noteIds, c.noteId) } })
    }
    case "edit-note": {
      const note = findNote(p, c.noteId)
      if (note === undefined) return entityFailure(commandIndex, "note", c.noteId, false)
      if (note.text !== c.expectedText) return precondition(commandIndex, "text", c.expectedText, note.text)
      if (note.text === c.text) return applied(p)
      const next = { ...note, text: c.text, textChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, notes: replaceById(p.notes, (value) => value.noteId === note.noteId, next) })
    }
    case "set-note-color": {
      const note = findNote(p, c.noteId)
      if (note === undefined) return entityFailure(commandIndex, "note", c.noteId, false)
      if (note.colorChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "colorChangedByChangeId", c.expectedChangedByChangeId, note.colorChangedByChangeId)
      if (note.color === c.color) return applied(p)
      const next = { ...note, color: c.color, colorChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, notes: replaceById(p.notes, (value) => value.noteId === note.noteId, next) })
    }
    case "set-note-geometry": {
      const note = findNote(p, c.noteId)
      if (note === undefined) return entityFailure(commandIndex, "note", c.noteId, false)
      if (note.geometryChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "geometryChangedByChangeId", c.expectedChangedByChangeId, note.geometryChangedByChangeId)
      if (geometryEquals(note.geometry, c.geometry)) return applied(p)
      const next = { ...note, geometry: c.geometry, geometryChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, notes: replaceById(p.notes, (item) => item.noteId === note.noteId, next) })
    }
    case "attach-note": case "detach-note": {
      const note = findNote(p, c.noteId)
      if (note === undefined) return entityFailure(commandIndex, "note", c.noteId, false)
      if (note.attachmentChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "attachmentChangedByChangeId", c.expectedChangedByChangeId, note.attachmentChangedByChangeId)
      const frameId = c._tag === "attach-note" ? c.frameId : null
      if (frameId !== null && findFrame(p, frameId) === undefined) return reject(InvalidReference.make({ commandIndex, field: "frameId", id: frameId }, trusted))
      if (note.attachedFrameId === frameId) return applied(p)
      const next = { ...note, attachedFrameId: frameId, attachmentChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, notes: replaceById(p.notes, (item) => item.noteId === note.noteId, next) })
    }
    case "remove-note": {
      const note = findNote(p, c.noteId)
      if (note === undefined) return entityFailure(commandIndex, "note", c.noteId, false)
      if (note.updatedByChangeId !== c.expectedUpdatedByChangeId) return precondition(commandIndex, "updatedByChangeId", c.expectedUpdatedByChangeId, note.updatedByChangeId)
      return applied({ ...p, notes: p.notes.filter((value) => value.noteId !== c.noteId), stack: p.stack.filter((item) => !(item._tag === "note" && item.noteId === c.noteId)), stackChangedByChangeId: changeId })
    }
  }
}

const applyCommentCommand = (
  p: CanvasProjection,
  c: CommentAggregateCommand,
  commandIndex: number,
  changeId: ChangeId,
  author: ActorSnapshot
): CanvasChangeResult => {
  switch (c._tag) {
    case "add-comment-thread": {
      if (p.issuedIds.threadIds.includes(c.threadId)) return entityFailure(commandIndex, "thread", c.threadId, true)
      if (p.issuedIds.commentIds.includes(c.commentId)) return entityFailure(commandIndex, "comment", c.commentId, true)
      const frame = findFrame(p, c.anchor.frameId)
      if (frame === undefined) return reject(InvalidReference.make({ commandIndex, field: "anchor.frameId", id: c.anchor.frameId }, trusted))
      if (c.anchor._tag === "element" && c.anchor.representationChangedByChangeId !== frame.representationChangedByChangeId) return precondition(commandIndex, "anchor.representationChangedByChangeId", c.anchor.representationChangedByChangeId, frame.representationChangedByChangeId)
      const thread: CommentThread = { threadId: c.threadId, anchor: c.anchor, resolved: false, comments: [{ commentId: c.commentId, body: c.body, author, createdByChangeId: changeId, bodyChangedByChangeId: changeId }], createdByChangeId: changeId, updatedByChangeId: changeId, anchorChangedByChangeId: changeId, resolutionChangedByChangeId: changeId }
      return applied({ ...p, threads: [...p.threads, thread].sort((a, b) => compareCanonicalId(a.threadId, b.threadId)), issuedIds: { ...p.issuedIds, threadIds: insertSorted(p.issuedIds.threadIds, c.threadId), commentIds: insertSorted(p.issuedIds.commentIds, c.commentId) } })
    }
    case "reply-to-comment-thread": {
      const thread = findThread(p, c.threadId)
      if (thread === undefined) return entityFailure(commandIndex, "thread", c.threadId, false)
      if (p.issuedIds.commentIds.includes(c.commentId)) return entityFailure(commandIndex, "comment", c.commentId, true)
      const next = { ...thread, comments: appendNonEmpty(thread.comments, { commentId: c.commentId, body: c.body, author, createdByChangeId: changeId, bodyChangedByChangeId: changeId }), updatedByChangeId: changeId }
      return applied({ ...p, threads: replaceById(p.threads, (value) => value.threadId === thread.threadId, next), issuedIds: { ...p.issuedIds, commentIds: insertSorted(p.issuedIds.commentIds, c.commentId) } })
    }
    case "edit-comment": {
      const thread = findThread(p, c.threadId)
      if (thread === undefined) return entityFailure(commandIndex, "thread", c.threadId, false)
      const comment = thread.comments.find((value) => value.commentId === c.commentId)
      if (comment === undefined) return entityFailure(commandIndex, "comment", c.commentId, false)
      if (comment.body !== c.expectedBody) return precondition(commandIndex, "body", c.expectedBody, comment.body)
      if (comment.body === c.body) return applied(p)
      const update = (value: typeof comment) => value.commentId === comment.commentId ? { ...value, body: c.body, bodyChangedByChangeId: changeId } : value
      const next = { ...thread, comments: mapNonEmpty(thread.comments, update), updatedByChangeId: changeId }
      return applied({ ...p, threads: replaceById(p.threads, (value) => value.threadId === thread.threadId, next) })
    }
    case "set-comment-thread-resolution": {
      const thread = findThread(p, c.threadId)
      if (thread === undefined) return entityFailure(commandIndex, "thread", c.threadId, false)
      if (thread.resolutionChangedByChangeId !== c.expectedChangedByChangeId) return precondition(commandIndex, "resolutionChangedByChangeId", c.expectedChangedByChangeId, thread.resolutionChangedByChangeId)
      if (thread.resolved === c.resolved) return applied(p)
      const next = { ...thread, resolved: c.resolved, resolutionChangedByChangeId: changeId, updatedByChangeId: changeId }
      return applied({ ...p, threads: replaceById(p.threads, (value) => value.threadId === thread.threadId, next) })
    }
  }
}

const applyCommand = (
  p: CanvasProjection,
  c: CanvasCommand,
  commandIndex: number,
  changeId: ChangeId,
  author: ActorSnapshot
): CanvasChangeResult => {
  switch (c._tag) {
    case "rename-canvas": return applyCanvasCommand(p, c, commandIndex)
    case "add-frame": case "set-frame-title": case "set-frame-representation": case "set-frame-status": case "set-frame-geometry": case "remove-frame":
      return applyFrameCommand(p, c, commandIndex, changeId)
    case "place-canvas-item": return applyStackCommand(p, c, commandIndex, changeId)
    case "add-note": case "edit-note": case "set-note-color": case "set-note-geometry": case "attach-note": case "detach-note": case "remove-note":
      return applyNoteCommand(p, c, commandIndex, changeId, author)
    case "add-comment-thread": case "reply-to-comment-thread": case "edit-comment": case "set-comment-thread-resolution":
      return applyCommentCommand(p, c, commandIndex, changeId, author)
  }
}

const applyCommands = (
  initial: CanvasProjection,
  commands: CanvasCommandBatch,
  changeId: ChangeId,
  author: ActorSnapshot
): CanvasChangeResult => {
  let projection = initial
  for (const [commandIndex, command] of commands.entries()) {
    const result = applyCommand(projection, command, commandIndex, changeId, author)
    if (result._tag === "rejected") return result
    projection = result.projection
  }
  return applied(projection)
}
const apply = (
  projection: CanvasProjection,
  change: CanvasChange,
  author: ActorSnapshot
): CanvasChangeResult => projection.canvasId !== change.canvasId
  ? reject(CanvasMismatch.make({ expectedCanvasId: projection.canvasId, actualCanvasId: change.canvasId }, trusted))
  : applyCommands(projection, change.commands, change.changeId, author)
const replay = (initial: CanvasProjection, changes: readonly AuthoredEngineChange[]): CanvasReplayResult => {
  let projection = initial
  const seen = new Map<ChangeId, number>()
  for (const [changeIndex, change] of changes.entries()) {
    const firstIndex = seen.get(change.changeId)
    if (firstIndex !== undefined) return ReplayFailed.make({ failure: DuplicateChange.make({ changeId: change.changeId, firstIndex, currentIndex: changeIndex }, trusted) }, trusted)
    const result = apply(projection, change, change.author)
    if (result._tag === "rejected") return ReplayFailed.make({ failure: ChangeRejected.make({ changeIndex, changeId: change.changeId, failure: result.failure }, trusted) }, trusted)
    seen.set(change.changeId, changeIndex)
    projection = result.projection
  }
  return Replayed.make({ projection }, trusted)
}
export const CanvasEngine = { apply, replay }
