import { type Store, type StoreSnapshot } from "@tldraw/store"
import { createShapeId, type TLRecord } from "@tldraw/tlschema"
import { getIndexAbove, type IndexKey } from "@tldraw/utils"
import { Effect, Schema } from "effect"

import {
  CanvasCommandSchema,
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

type CanvasState = {
  readonly id: string
  readonly title: string
  readonly revision: number
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

const open = (
  input: unknown
): Effect.Effect<Canvas, CanvasOpenFailed | AssetUnsupported> =>
  Schema.decodeUnknownEffect(CanvasDocument)(input).pipe(
    Effect.mapError(
      (cause) =>
        new CanvasOpenFailed({
          reason: "invalid-envelope",
          detail: String(cause)
        })
    ),
    Effect.flatMap((document) =>
      Effect.try({
        try: () => openDocument(document),
        catch: (cause) =>
          cause instanceof AssetUnsupported
            ? cause
            : new CanvasOpenFailed({
                reason: "invalid-document",
                detail: cause instanceof Error ? cause.message : String(cause)
              })
      })
    )
  )

const exportCanvas = (canvas: Canvas): CanvasDocument => {
  const state = stateOf(canvas)
  const document = state.store.getStoreSnapshot("document")
  const assetIds = findAssetIds(document)
  if (assetIds.length > 0) throw new AssetUnsupported({ assetIds })

  return {
    format: "crit-canvas",
    version: 1,
    id: state.id,
    title: state.title,
    revision: state.revision,
    document
  }
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
          const changedFrameIds: Array<string> = []

          for (const command of decoded) {
            const frameId = createShapeId(command.id)
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
              const record = planned.get(frameId) ?? state.store.get(frameId)
              if (record === undefined || !isCritFrame(record)) {
                throw new CanvasCommandFailed({
                  reason: "frame-not-found",
                  detail: `Frame not found: ${frameId}`
                })
              }
              planned.set(frameId, {
                ...record,
                props: { ...record.props, status: command.status }
              })
            }
            if (!changedFrameIds.includes(frameId)) changedFrameIds.push(frameId)
          }

          state.store.put(Array.from(planned.values()))

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
  summarize
} as const
