import * as NodeServices from "@effect/platform-node/NodeServices"
import { open as openFile } from "node:fs/promises"
import { Effect, FileSystem, Layer, Path } from "effect"

import { Canvas, CanvasInternals, type CanvasDocument } from "../core/canvas.js"
import {
  CanvasAlreadyExists,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  CanvasInvalidDocument,
  CanvasNotFound,
  CanvasUnavailable
} from "../core/canvas-errors.js"
import {
  CanvasRepository,
  type CanvasRepositoryShape
} from "../runtime/canvas-repository.js"
import {
  canonicalizeDocument,
  serializeDocument
} from "../runtime/internal/document-codec.js"

const storageFailure = (operation: string, canvasId: string, cause: unknown) =>
  new CanvasUnavailable({
    operation,
    canvasId,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const make = (root: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = path.join(root, ".crit", "canvases")
    const filePath = (id: string) => path.join(directory, `${encodeURIComponent(id)}.json`)

    const read: CanvasRepositoryShape["load"] = (id) => {
      const target = filePath(id)
      return Effect.gen(function*() {
        const exists = yield* fs
          .exists(target)
          .pipe(Effect.mapError((cause) => storageFailure("load", id, cause)))
        if (!exists) return yield* new CanvasNotFound({ canvasId: id })

        const contents = yield* fs
          .readFileString(target)
          .pipe(Effect.mapError((cause) => storageFailure("load", id, cause)))
        const input = yield* Effect.try({
          try: () => JSON.parse(contents) as unknown,
          catch: (cause) =>
            new CanvasInvalidDocument({
              canvasId: id,
              detail: cause instanceof Error ? cause.message : String(cause)
            })
        })
        return yield* canonicalizeDocument(id, input)
      })
    }

    const create: CanvasRepositoryShape["create"] = (document) =>
      Effect.gen(function*() {
        const canonical = yield* canonicalizeDocument(document.id, document)
        yield* fs
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.mapError((cause) => storageFailure("create", document.id, cause)))
        const exists = yield* fs
          .exists(filePath(document.id))
          .pipe(Effect.mapError((cause) => storageFailure("create", document.id, cause)))
        if (exists) {
          const current = yield* read(document.id).pipe(
            Effect.catchTag("CanvasNotFound", () =>
              Effect.fail(
                storageFailure(
                  "create",
                  document.id,
                  "Document disappeared during conditional creation"
                )
              )
            )
          )
          return yield* new CanvasAlreadyExists({
            canvasId: document.id,
            currentRevision: current.revision
          })
        }
        yield* fs
          .writeFileString(filePath(document.id), serializeDocument(canonical), {
            flag: "wx",
            mode: 0o600
          })
          .pipe(Effect.mapError((cause) => storageFailure("create", document.id, cause)))
        return canonical
      })

    const list: CanvasRepositoryShape["list"] = () =>
      Effect.gen(function*() {
        const exists = yield* fs
          .exists(directory)
          .pipe(Effect.mapError((cause) => storageFailure("list", "*", cause)))
        if (!exists) return []

        const entries = yield* fs
          .readDirectory(directory)
          .pipe(Effect.mapError((cause) => storageFailure("list", "*", cause)))
        const ids = yield* Effect.forEach(
          entries.filter((entry) => entry.endsWith(".json")),
          (entry) =>
            Effect.try({
              try: () => decodeURIComponent(entry.slice(0, -".json".length)),
              catch: (cause) =>
                new CanvasInvalidDocument({
                  canvasId: entry,
                  detail: cause instanceof Error ? cause.message : String(cause)
                })
            })
        )
        const documents = yield* Effect.forEach(ids, (id) =>
          read(id).pipe(
            Effect.catchTag("CanvasNotFound", () => Effect.succeed(undefined))
          )
        )
        return documents
          .filter((document): document is CanvasDocument => document !== undefined)
          .sort((left, right) => left.id.localeCompare(right.id))
      })

    const apply: CanvasRepositoryShape["apply"] = (id, commands) => {
      const target = filePath(id)
      const lock = `${target}.lock`
      const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`

      const acquire = Effect.tryPromise({
        try: async () => {
          const deadline = Date.now() + 5_000
          for (;;) {
            try {
              const handle = await openFile(lock, "wx", 0o600)
              await handle.writeFile(`${process.pid}\n`)
              await handle.close()
              return
            } catch (cause) {
              if (
                !(cause instanceof Error && "code" in cause && cause.code === "EEXIST") ||
                Date.now() >= deadline
              ) {
                throw cause
              }
              await new Promise((resolve) => setTimeout(resolve, 10))
            }
          }
        },
        catch: (cause) => storageFailure("lock", id, cause)
      })

      const mutate = Effect.gen(function*() {
        // read() canonicalizes through Canvas.open, so this document is trusted.
        const current = yield* read(id)
        const canvas = Canvas.fromDocument(current)
        const change = yield* Canvas.apply(canvas, ...commands)
        CanvasInternals.setRevision(canvas, current.revision + 1)
        const next = yield* Effect.try({
          try: () => Canvas.export(canvas),
          catch: (cause) =>
            cause instanceof CanvasDocumentTooLarge
              ? cause
              : storageFailure("apply", id, cause)
        })
        yield* fs
          .writeFileString(temporary, serializeDocument(next), { mode: 0o600 })
          .pipe(Effect.mapError((cause) => storageFailure("apply", id, cause)))
        yield* fs
          .rename(temporary, target)
          .pipe(Effect.mapError((cause) => storageFailure("apply", id, cause)))
        return { document: next, change }
      }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)))

      if (commands.length === 0) {
        return Effect.fail(
          new CanvasCommandFailed({
            canvasId: id,
            reason: "invalid-command",
            detail: "A durable Canvas update requires at least one command"
          })
        )
      }

      return read(id).pipe(
        Effect.andThen(acquire),
        Effect.andThen(
          mutate.pipe(Effect.ensuring(fs.remove(lock).pipe(Effect.ignore)))
        )
      )
    }

    return { create, load: read, list, apply } satisfies CanvasRepositoryShape
  })

const layer = (options: { readonly root: string }) =>
  Layer.effect(CanvasRepository, make(options.root)).pipe(Layer.provide(NodeServices.layer))

export const FileSystemCanvasRepository = { layer } as const
