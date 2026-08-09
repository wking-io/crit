import * as NodeServices from "@effect/platform-node/NodeServices"
import { open as openFile, readFile, stat, unlink } from "node:fs/promises"
import { Effect, FileSystem, Layer, Path } from "effect"

import {
  Canvas,
  CanvasDocumentTooLarge,
  CanvasInternals,
  type CanvasDocument
} from "../core/canvas.js"
import {
  DocumentAlreadyExists,
  CanvasRepository,
  type CanvasRepositoryShape
} from "../runtime/canvas-repository.js"
import {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  rejectedCanvasCommand,
  unavailableCanvas
} from "../runtime/canvas-failure.js"
import {
  canonicalizeDocument,
  serializeDocument
} from "../runtime/internal/document-codec.js"

const storageFailure = (operation: string, id: string, cause: unknown) =>
  unavailableCanvas(operation, id, cause)

// A Canvas mutation holds its lock for one read-apply-write cycle, so any
// lock older than this belongs to a wedged or dead writer and is safe to steal.
const staleLockTtlMillis = 60_000

const hasCode = (cause: unknown, code: string) =>
  cause instanceof Error && "code" in cause && cause.code === code

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // EPERM means the process exists but belongs to another user.
    return hasCode(cause, "EPERM")
  }
}

/**
 * Removes the lock file when its owner is provably gone. Returns whether the
 * caller should immediately retry acquisition.
 *
 * A lock is stale when its recorded PID is no longer alive, or — covering
 * recycled PIDs and locks whose contents never got written — when its mtime
 * exceeds a generous TTL. A fresh lock without a parseable PID is never
 * stolen: the owner may sit between creating the file and recording its PID.
 */
const removeLockIfStale = async (lock: string) => {
  let modifiedAtMillis: number
  try {
    modifiedAtMillis = (await stat(lock)).mtimeMs
  } catch (cause) {
    if (hasCode(cause, "ENOENT")) return true
    throw cause
  }

  let ownerDead = false
  try {
    const pid = Number.parseInt((await readFile(lock, "utf8")).trim(), 10)
    ownerDead = Number.isSafeInteger(pid) && pid > 0 && !isProcessAlive(pid)
  } catch (cause) {
    if (!hasCode(cause, "ENOENT")) throw cause
    return true
  }

  const expired = Date.now() - modifiedAtMillis > staleLockTtlMillis
  if (!ownerDead && !expired) return false

  try {
    await unlink(lock)
  } catch (cause) {
    if (!hasCode(cause, "ENOENT")) throw cause
  }
  return true
}

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
        if (!exists) return yield* new CritClientNotFound({ id })

        const contents = yield* fs
          .readFileString(target)
          .pipe(Effect.mapError((cause) => storageFailure("load", id, cause)))
        const input = yield* Effect.try({
          try: () => JSON.parse(contents) as unknown,
          catch: (cause) =>
            new CritClientInvalidDocument({
              id,
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
            Effect.catchTag("CritClientNotFound", () =>
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
                new CritClientInvalidDocument({
                  id: entry,
                  detail: cause instanceof Error ? cause.message : String(cause)
                })
            })
        )
        const documents = yield* Effect.forEach(ids, (id) =>
          read(id).pipe(
            Effect.catchTag("CritClientNotFound", () => Effect.succeed(undefined))
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
          let checkedForStaleLock = false
          for (;;) {
            try {
              const handle = await openFile(lock, "wx", 0o600)
              await handle.writeFile(`${process.pid}\n`)
              await handle.close()
              return
            } catch (cause) {
              if (!hasCode(cause, "EEXIST")) throw cause
              if (!checkedForStaleLock) {
                checkedForStaleLock = true
                if (await removeLockIfStale(lock)) continue
              }
              if (Date.now() >= deadline) {
                throw new Error(
                  `Timed out waiting for the Canvas lock held by a live writer: ${lock}`
                )
              }
              await new Promise((resolve) => setTimeout(resolve, 10))
            }
          }
        },
        catch: (cause) => storageFailure("lock", id, cause)
      })

      const mutate = Effect.gen(function*() {
        const current = yield* read(id)
        const canvas = Canvas.fromDocument(current)
        const change = yield* Canvas.apply(canvas, ...commands).pipe(
          Effect.mapError((cause) => rejectedCanvasCommand(id, cause))
        )
        CanvasInternals.setRevision(canvas, current.revision + 1)
        const next = yield* Effect.try({
          try: () => Canvas.export(canvas),
          catch: (cause) =>
            cause instanceof CanvasDocumentTooLarge
              ? new CritClientInvalidDocument({ id, detail: cause.detail })
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
          new CritClientCommandFailed({
            id,
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
