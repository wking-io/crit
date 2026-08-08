import { type Store, type StoreSnapshot } from "@tldraw/store"
import { createShapeId, type TLRecord } from "@tldraw/tlschema"
import { getIndexAbove, type IndexKey } from "@tldraw/utils"
import { Effect, Schema } from "effect"

import {
  CanvasCommandSchema,
  FrameDisplay,
  FrameProvenance,
  FrameStatus,
  type CanvasCommand as CanvasCommandInput
} from "./canvas-command.js"
import {
  critSchema,
  findAssetIds,
  isCritFrame,
  makePage,
  makeStore,
  type CritFrame
} from "./internal/tldraw-schema.js"

const CanvasTypeId: unique symbol = Symbol.for("@riff-refine/crit/Canvas")

export const MAX_CANVAS_DOCUMENT_BYTES = 10_000_000

export interface Canvas {
  readonly [CanvasTypeId]: typeof CanvasTypeId
}

export const CanvasDocument = Schema.Struct({
  format: Schema.Literal("crit-canvas"),
  version: Schema.Literal(1),
  id: Schema.String,
  title: Schema.String,
  revision: Schema.Number,
  document: Schema.Unknown
})

export type CanvasDocument = typeof CanvasDocument.Type

export const CanvasSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  revision: Schema.Number,
  frameCount: Schema.Number,
  statuses: Schema.Struct({
    inProgress: Schema.Number,
    approved: Schema.Number,
    changesRequested: Schema.Number
  })
})

export type CanvasSummary = typeof CanvasSummary.Type

export const FrameSummary = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  status: FrameStatus,
  provenance: FrameProvenance,
  display: FrameDisplay,
  geometry: Schema.Struct({
    x: Schema.Finite,
    y: Schema.Finite,
    width: Schema.Finite,
    height: Schema.Finite
  })
})
export type FrameSummary = typeof FrameSummary.Type

export const FrameList = Schema.Array(FrameSummary)
export type FrameList = typeof FrameList.Type

export const CanvasChange = Schema.Struct({
  commandCount: Schema.Number,
  changedFrameIds: Schema.Array(Schema.String)
})
export type CanvasChange = typeof CanvasChange.Type

export class CanvasOpenFailed extends Schema.TaggedError<CanvasOpenFailed>()(
  "CanvasOpenFailed",
  {
    reason: Schema.Union([
      Schema.Literal("invalid-envelope"),
      Schema.Literal("invalid-document")
    ]),
    detail: Schema.String
  }
) {}

export class AssetUnsupported extends Schema.TaggedError<AssetUnsupported>()(
  "AssetUnsupported",
  {
    assetIds: Schema.Array(Schema.String)
  }
) {}

export class CanvasDocumentTooLarge extends Schema.TaggedError<CanvasDocumentTooLarge>()(
  "CanvasDocumentTooLarge",
  {
    actualBytes: Schema.Number,
    maxBytes: Schema.Number
  }
) {}

export class CanvasCommandFailed extends Schema.TaggedError<CanvasCommandFailed>()(
  "CanvasCommandFailed",
  {
    reason: Schema.Union([
      Schema.Literal("invalid-command"),
      Schema.Literal("duplicate-frame"),
      Schema.Literal("frame-not-found"),
      Schema.Literal("invalid-canvas"),
      Schema.Literal("apply-failed")
    ]),
    detail: Schema.String
  }
) {}

export class FrameNotFound extends Schema.TaggedError<FrameNotFound>()(
  "FrameNotFound",
  { id: Schema.String }
) {}

type CanvasState = {
  readonly id: string
  title: string
  revision: number
  readonly store: Store<TLRecord>
}

const states = new WeakMap<object, CanvasState>()

const makeCanvas = (state: CanvasState): Canvas => {
  const handle = Object.freeze({}) as Canvas
  states.set(handle, state)
  return handle
}

const stateOf = (canvas: Canvas): CanvasState => {
  const state = states.get(canvas)
  if (state === undefined) {
    throw new TypeError("Canvas was not created by @riff-refine/crit")
  }
  return state
}

export const CanvasInternals = {
  store: (canvas: Canvas) => stateOf(canvas).store,
  setRevision: (canvas: Canvas, revision: number) => {
    stateOf(canvas).revision = revision
  },
  adoptDocument: (canvas: Canvas, incoming: Canvas) => {
    const target = stateOf(canvas)
    const source = stateOf(incoming)
    if (target.id !== source.id) {
      throw new TypeError(
        `Cannot adopt Canvas ${source.id} into Canvas ${target.id}`
      )
    }
    const snapshot = source.store.getStoreSnapshot("document")
    const records = Object.values(snapshot.store)
    const incomingIds = new Set(records.map((record) => record.id))
    const removedIds = target.store
      .allRecords()
      .filter(
        (record) =>
          target.store.scopedTypes.document.has(record.typeName) &&
          !incomingIds.has(record.id)
      )
      .map((record) => record.id)
    target.store.mergeRemoteChanges(() => {
      if (removedIds.length > 0) target.store.remove(removedIds)
      if (records.length > 0) target.store.put(records)
    })
    target.title = source.title
    target.revision = source.revision
  }
} as const

const create = (input: { readonly id: string; readonly title: string }): Canvas => {
  const store = makeStore()
  store.put([makePage(input.id, input.title)])
  return makeCanvas({ ...input, revision: 0, store })
}

const openDocument = (document: CanvasDocument): Canvas => {
  const snapshot = document.document as StoreSnapshot<TLRecord>
  const assetIds = findAssetIds(snapshot)
  if (assetIds.length > 0) throw new AssetUnsupported({ assetIds })

  const migration = critSchema.migrateStoreSnapshot(snapshot)
  if (migration.type !== "success") {
    throw new Error(`tldraw migration failed: ${migration.reason}`)
  }

  const store = makeStore(critSchema, migration.value)
  const pages = store.allRecords().filter((record) => record.typeName === "page")
  if (pages.length !== 1) {
    throw new Error(`Canvas must contain exactly one page; found ${pages.length}`)
  }

  return makeCanvas({
    id: document.id,
    title: document.title,
    revision: document.revision,
    store
  })
}

const encodedBytes = (input: unknown) => {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable")
  return new TextEncoder().encode(serialized).byteLength
}

const open = (
  input: unknown
): Effect.Effect<
  Canvas,
  CanvasOpenFailed | AssetUnsupported | CanvasDocumentTooLarge
> =>
  Effect.gen(function*() {
    const actualBytes = yield* Effect.try({
      try: () => encodedBytes(input),
      catch: (cause) =>
        new CanvasOpenFailed({
          reason: "invalid-envelope",
          detail: cause instanceof Error ? cause.message : String(cause)
        })
    })
    if (actualBytes > MAX_CANVAS_DOCUMENT_BYTES) {
      return yield* new CanvasDocumentTooLarge({
        actualBytes,
        maxBytes: MAX_CANVAS_DOCUMENT_BYTES
      })
    }

    const document = yield* Schema.decodeUnknownEffect(CanvasDocument)(input).pipe(
      Effect.mapError(
        (cause) =>
          new CanvasOpenFailed({
            reason: "invalid-envelope",
            detail: String(cause)
          })
      )
    )
    return yield* Effect.try({
      try: () => openDocument(document),
      catch: (cause) =>
        cause instanceof AssetUnsupported
          ? cause
          : new CanvasOpenFailed({
              reason: "invalid-document",
              detail: cause instanceof Error ? cause.message : String(cause)
            })
    })
  })

const exportCanvas = (canvas: Canvas): CanvasDocument => {
  const state = stateOf(canvas)
  const document = state.store.getStoreSnapshot("document")
  const assetIds = findAssetIds(document)
  if (assetIds.length > 0) throw new AssetUnsupported({ assetIds })

  const exported: CanvasDocument = {
    format: "crit-canvas",
    version: 1,
    id: state.id,
    title: state.title,
    revision: state.revision,
    document
  }
  const actualBytes = encodedBytes(exported)
  if (actualBytes > MAX_CANVAS_DOCUMENT_BYTES) {
    throw new CanvasDocumentTooLarge({
      actualBytes,
      maxBytes: MAX_CANVAS_DOCUMENT_BYTES
    })
  }
  return exported
}

const summarize = (canvas: Canvas): CanvasSummary => {
  const state = stateOf(canvas)
  const statuses = {
    inProgress: 0,
    approved: 0,
    changesRequested: 0
  }

  let frameCount = 0
  for (const record of state.store.allRecords()) {
    if (!isCritFrame(record)) continue
    frameCount += 1
    switch (record.props.status) {
      case "in-progress":
        statuses.inProgress += 1
        break
      case "approved":
        statuses.approved += 1
        break
      case "changes-requested":
        statuses.changesRequested += 1
        break
    }
  }

  return {
    id: state.id,
    title: state.title,
    revision: state.revision,
    frameCount,
    statuses
  }
}

const frameIdFrom = (id: string) =>
  createShapeId(id.startsWith("shape:") ? id.slice("shape:".length) : id)

const summarizeFrame = (record: CritFrame): FrameSummary => ({
  id: record.id,
  url: record.props.url,
  title: record.props.title,
  status: record.props.status,
  provenance: record.props.provenance,
  display: record.props.display,
  geometry: {
    x: record.x,
    y: record.y,
    width: record.props.w,
    height: record.props.h
  }
})

const listFrames = (canvas: Canvas): FrameList =>
  stateOf(canvas)
    .store.allRecords()
    .filter(isCritFrame)
    .sort((left, right) => left.index.localeCompare(right.index))
    .map(summarizeFrame)

const getFrame = (
  canvas: Canvas,
  id: string
): Effect.Effect<FrameSummary, FrameNotFound> => {
  const frameId = frameIdFrom(id)
  const record = stateOf(canvas).store.get(frameId)
  if (record === undefined || !isCritFrame(record)) {
    return Effect.fail(new FrameNotFound({ id: frameId }))
  }
  return Effect.succeed(summarizeFrame(record))
}

const apply = (
  canvas: Canvas,
  ...commands: ReadonlyArray<CanvasCommandInput>
): Effect.Effect<CanvasChange, CanvasCommandFailed> => {
  const state = stateOf(canvas)

  return Effect.forEach(commands, (command) =>
    Schema.decodeUnknownEffect(CanvasCommandSchema)(command).pipe(
      Effect.mapError(
        (cause) =>
          new CanvasCommandFailed({
            reason: "invalid-command",
            detail: String(cause)
          })
      )
    )
  ).pipe(
    Effect.flatMap((decoded) =>
      Effect.try({
        try: () => {
          const pages = state.store
            .allRecords()
            .filter((record) => record.typeName === "page")
          if (pages.length !== 1) {
            throw new CanvasCommandFailed({
              reason: "invalid-canvas",
              detail: `Canvas must contain exactly one page; found ${pages.length}`
            })
          }
          const page = pages[0]!
          const existingFrames = state.store
            .allRecords()
            .filter(isCritFrame)
            .sort((left, right) => left.index.localeCompare(right.index))
          let index = existingFrames.at(-1)?.index ?? ("a0" as IndexKey)
          let frameNumber = existingFrames.length
          const planned = new Map<string, CritFrame>()
          const removedIds = new Set<TLRecord["id"]>()
          const changedFrameIds: Array<string> = []

          for (const command of decoded) {
            const frameId = frameIdFrom(command.id)
            if (command._tag === "AddFrame") {
              if (state.store.has(frameId) || planned.has(frameId)) {
                throw new CanvasCommandFailed({
                  reason: "duplicate-frame",
                  detail: `Frame already exists: ${frameId}`
                })
              }
              index = getIndexAbove(index)
              const record = critSchema.types.shape.create({
                id: frameId,
                type: "crit-frame",
                parentId: page.id,
                index,
                x: (frameNumber % 3) * 1240,
                y: Math.floor(frameNumber / 3) * 840,
                props: {
                  w: 1200,
                  h: 800,
                  url: command.url,
                  title: command.title,
                  status: command.status,
                  provenance: command.provenance,
                  display: { heightMode: "viewport" }
                }
              }) as CritFrame
              planned.set(frameId, record)
              frameNumber += 1
            } else {
              const record = removedIds.has(frameId)
                ? undefined
                : (planned.get(frameId) ?? state.store.get(frameId))
              if (record === undefined || !isCritFrame(record)) {
                throw new CanvasCommandFailed({
                  reason: "frame-not-found",
                  detail: `Frame not found: ${frameId}`
                })
              }
              if (command._tag === "RemoveFrame") {
                planned.delete(frameId)
                const pending: Array<TLRecord["id"]> = [frameId]
                const records = state.store.allRecords()
                while (pending.length > 0) {
                  const parentId = pending.pop()!
                  if (removedIds.has(parentId)) continue
                  removedIds.add(parentId)
                  for (const child of records) {
                    if (
                      child.typeName === "shape" &&
                      child.parentId === parentId
                    ) {
                      pending.push(child.id)
                    }
                  }
                }
              } else if (command._tag === "SetFrameStatus") {
                planned.set(frameId, {
                  ...record,
                  props: { ...record.props, status: command.status }
                })
              } else if (command._tag === "MoveFrame") {
                planned.set(frameId, {
                  ...record,
                  x: command.x,
                  y: command.y
                })
              } else if (command._tag === "ResizeFrame") {
                planned.set(frameId, {
                  ...record,
                  props: {
                    ...record.props,
                    w: command.width,
                    h: command.height
                  }
                })
              } else {
                const { changes } = command
                if (Object.values(changes).every((value) => value === undefined)) {
                  throw new CanvasCommandFailed({
                    reason: "invalid-command",
                    detail: `UpdateFrame requires at least one change: ${frameId}`
                  })
                }
                planned.set(frameId, {
                  ...record,
                  props: {
                    ...record.props,
                    ...(changes.url === undefined ? {} : { url: changes.url }),
                    ...(changes.title === undefined ? {} : { title: changes.title }),
                    ...(changes.status === undefined ? {} : { status: changes.status }),
                    ...(changes.provenance === undefined
                      ? {}
                      : { provenance: changes.provenance }),
                    ...(changes.display === undefined
                      ? {}
                      : { display: changes.display })
                  }
                })
              }
            }
            if (!changedFrameIds.includes(frameId)) changedFrameIds.push(frameId)
          }

          state.store.mergeRemoteChanges(() => {
            if (planned.size > 0) {
              state.store.put(Array.from(planned.values()))
            }
            const persistedRemovedIds = Array.from(removedIds).filter((id) =>
              state.store.has(id)
            )
            if (persistedRemovedIds.length > 0) {
              state.store.remove(persistedRemovedIds)
            }
          })

          return {
            commandCount: decoded.length,
            changedFrameIds
          }
        },
        catch: (cause) =>
          cause instanceof CanvasCommandFailed
            ? cause
            : new CanvasCommandFailed({
                reason: "apply-failed",
                detail: cause instanceof Error ? cause.message : String(cause)
              })
      })
    )
  )
}

export const Canvas = {
  create,
  open,
  apply,
  export: exportCanvas,
  summarize,
  listFrames,
  getFrame
} as const
