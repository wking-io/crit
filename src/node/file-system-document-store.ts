import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, FileSystem, Layer, Path } from "effect"

import { Canvas, type CanvasDocument } from "../core/index.js"
import {
  DocumentAlreadyExists,
  DocumentConflict,
  DocumentMalformed,
  DocumentNotFound,
  DocumentStorageFailed,
  DocumentStore,
  type DocumentStoreShape
} from "../runtime/document-store.js"

const serialize = (document: CanvasDocument) => `${JSON.stringify(document)}\n`

const canonicalize = (id: string, input: unknown) =>
  Canvas.open(input).pipe(
    Effect.map(Canvas.export),
    Effect.mapError(
      (cause) =>
        new DocumentMalformed({
          id,
          detail:
            cause._tag === "AssetUnsupported"
              ? `Asset records are unsupported: ${cause.assetIds.join(", ")}`
              : cause.detail
        })
    )
  )

const storageFailure = (operation: string, id: string, cause: unknown) =>
  new DocumentStorageFailed({
    operation,
    id,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const make = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = path.join(root, ".crit", "canvases")
    const filePath = (id: string) => path.join(directory, `${encodeURIComponent(id)}.json`)

    const read: DocumentStoreShape["load"] = (id) => {
      const target = filePath(id)
      return Effect.gen(function*() {
        const exists = yield* fs
          .exists(target)
          .pipe(Effect.mapError((cause) => storageFailure("load", id, cause)))
        if (!exists) return yield* new DocumentNotFound({ id })

        const contents = yield* fs
          .readFileString(target)
          .pipe(Effect.mapError((cause) => storageFailure("load", id, cause)))
        const input = yield* Effect.try({
          try: () => JSON.parse(contents) as unknown,
          catch: (cause) =>
            new DocumentMalformed({
              id,
              detail: cause instanceof Error ? cause.message : String(cause)
            })
        })
        return yield* canonicalize(id, input)
      })
    }

    const create: DocumentStoreShape["create"] = (document) =>
      Effect.gen(function*() {
        const canonical = yield* canonicalize(document.id, document)
        yield* fs
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.mapError((cause) => storageFailure("create", document.id, cause)))
        const exists = yield* fs
          .exists(filePath(document.id))
          .pipe(Effect.mapError((cause) => storageFailure("create", document.id, cause)))
        if (exists) {
          const current = yield* read(document.id).pipe(
            Effect.catchTag("DocumentNotFound", () =>
              Effect.fail(
                storageFailure(
                  "create",
                  document.id,
                  "Document disappeared during conditional creation"
                )
              )
            )
          )
          return yield* new DocumentAlreadyExists({
            id: document.id,
            currentRevision: current.revision
          })
        }
        yield* fs
          .writeFileString(filePath(document.id), serialize(canonical), {
            flag: "wx",
            mode: 0o600
          })
          .pipe(Effect.mapError((cause) => storageFailure("create", document.id, cause)))
        return canonical
      })

    const save: DocumentStoreShape["save"] = (document, options) => {
      const id = document.id
      const target = filePath(id)
      const lock = `${target}.lock`
      const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`

      const write = Effect.gen(function*() {
        const current = yield* read(id)
        if (current.revision !== options.expectedRevision) {
          return yield* new DocumentConflict({
            id,
            expectedRevision: options.expectedRevision,
            currentRevision: current.revision
          })
        }

        const canonical = yield* canonicalize(id, document)
        const next: CanvasDocument = {
          ...canonical,
          revision: current.revision + 1
        }
        yield* fs
          .writeFileString(temporary, serialize(next), { mode: 0o600 })
          .pipe(Effect.mapError((cause) => storageFailure("save", id, cause)))
        yield* fs
          .rename(temporary, target)
          .pipe(Effect.mapError((cause) => storageFailure("save", id, cause)))
        return next
      }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)))

      return fs.writeFileString(lock, `${process.pid}\n`, {
        flag: "wx",
        mode: 0o600
      }).pipe(
        Effect.mapError((cause) => storageFailure("lock", id, cause)),
        Effect.andThen(write),
        Effect.ensuring(fs.remove(lock).pipe(Effect.ignore))
      )
    }

    return { create, load: read, save } satisfies DocumentStoreShape
  })

const layer = (options: { readonly root: string }) =>
  Layer.effect(DocumentStore, make(options.root)).pipe(Layer.provide(NodeServices.layer))

export const FileSystemDocumentStore = { layer } as const
