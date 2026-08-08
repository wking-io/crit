import { type Store, type StoreSnapshot } from "@tldraw/store"
import type { TLRecord } from "@tldraw/tlschema"
import { Effect, Schema } from "effect"

import {
  assertNoAssets,
  critSchema,
  isCritFrame,
  makePage,
  makeStore
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
  assertNoAssets(snapshot)

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

const open = (input: unknown): Effect.Effect<Canvas, CanvasOpenFailed> =>
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
          new CanvasOpenFailed({
            reason: "invalid-document",
            detail: cause instanceof Error ? cause.message : String(cause)
          })
      })
    )
  )

const exportCanvas = (canvas: Canvas): CanvasDocument => {
  const state = stateOf(canvas)
  const document = state.store.getStoreSnapshot("document")
  assertNoAssets(document)

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

export const Canvas = {
  create,
  open,
  export: exportCanvas,
  summarize
} as const
