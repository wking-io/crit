import { Effect, FileSystem, Option, Path, Schema, Stdio, Stream } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import { CanvasCommand } from "../core/index.js"
import {
  CRIT_MANIFEST_FILE,
  CRIT_MANIFEST_PATH,
  CritManifest,
  CritManifestInvalid
} from "../discovery/index.js"
import { CritInitFailed, CritInitializer } from "../init/project-initializer.js"
import { CritRuntime } from "../runtime/crit-runtime.js"
import { PACKAGE_VERSION } from "../version.js"

class InvalidCliInput extends Schema.TaggedError<InvalidCliInput>()(
  "InvalidCliInput",
  { detail: Schema.String }
) {}

const writeStdout = (value: string) =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    yield* Stream.run(Stream.make(value), stdio.stdout())
  })

const parseJson = (source: string, contents: string) =>
  Effect.try({
    try: () => JSON.parse(contents) as unknown,
    catch: (cause) =>
      new CritManifestInvalid({
        source,
        detail: cause instanceof Error ? cause.message : String(cause)
      })
  })

const isAbsoluteHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

const loadManifest = (
  source: string,
  baseUrl: Option.Option<string>
) =>
  Effect.gen(function*() {
    if (isAbsoluteHttpUrl(source)) {
      const requested = new URL(source)
      if (
        requested.pathname === "/" &&
        requested.search.length === 0 &&
        requested.hash.length === 0
      ) {
        requested.pathname = CRIT_MANIFEST_PATH
      }
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(requested, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5_000)
          }),
        catch: (cause) =>
          new CritManifestInvalid({
            source: requested.toString(),
            detail: cause instanceof Error ? cause.message : String(cause)
          })
      })
      if (!response.ok) {
        return yield* new CritManifestInvalid({
          source: requested.toString(),
          detail: `Manifest request failed with status ${response.status}`
        })
      }
      const input = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (cause) =>
          new CritManifestInvalid({
            source: requested.toString(),
            detail: cause instanceof Error ? cause.message : String(cause)
          })
      })
      return yield* CritManifest.resolve(input, {
        baseUrl: requested.toString(),
        source: requested.toString()
      })
    }

    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.resolve(source)
    const contents = yield* fs.readFileString(target).pipe(
      Effect.mapError(
        (cause) =>
          new CritManifestInvalid({ source: target, detail: String(cause) })
      )
    )
    const input = yield* parseJson(target, contents)
    const decoded = yield* CritManifest.decode(input, target)
    const relativeFrame = decoded.canvases
      .flatMap((canvas) => canvas.frames)
      .find((frame) => !isAbsoluteHttpUrl(frame.url))
    if (relativeFrame !== undefined && Option.isNone(baseUrl)) {
      return yield* new CritManifestInvalid({
        source: target,
        detail: `Frame ${relativeFrame.id} uses a relative URL; pass --base-url or sync from a running app origin`
      })
    }
    return yield* CritManifest.resolve(decoded, {
      baseUrl: Option.getOrElse(baseUrl, () => "http://crit.invalid/"),
      source: target
    })
  })

const initCommand = Command.make(
  "init",
  {
    root: Flag.directory("root").pipe(Flag.withDefault(".")),
    skipInstall: Flag.boolean("skip-install"),
    json: Flag.boolean("json")
  },
  ({ root, skipInstall, json }) =>
    Effect.gen(function*() {
      const result = yield* CritInitializer.init({ root })
      let installed = false
      if (!skipInstall) {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const exitCode = yield* spawner
          .exitCode(
            ChildProcess.make(result.install.command, result.install.args, {
              cwd: result.install.cwd,
              stdout: "inherit",
              stderr: "inherit"
            })
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new CritInitFailed({
                  operation: "install",
                  path: result.root,
                  detail: String(cause)
                })
            )
          )
        if (Number(exitCode) !== 0) {
          return yield* new CritInitFailed({
            operation: "install",
            path: result.root,
            detail: `${result.install.command} ${result.install.args.join(" ")} exited with code ${Number(exitCode)}`
          })
        }
        installed = true
      }

      const output = json
        ? JSON.stringify({ ...result, installed })
        : [
            `Initialized Crit in ${result.root}.`,
            ...result.actions.map(
              (action) => `  ${action.status.padEnd(9)} ${action.path}`
            ),
            ...result.warnings.map((warning) => `  warning   ${warning}`),
            skipInstall
              ? `  next      ${result.install.command} ${result.install.args.join(" ")}`
              : "Crit dependencies are installed."
          ].join("\n")
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("Configure Crit in a Vite + React project"))

const syncCommand = Command.make(
  "sync",
  {
    source: Flag.string("from").pipe(Flag.withDefault(CRIT_MANIFEST_FILE)),
    baseUrl: Flag.string("base-url").pipe(Flag.optional),
    canvas: Flag.string("canvas").pipe(Flag.optional),
    json: Flag.boolean("json")
  },
  ({ source, baseUrl, canvas, json }) =>
    Effect.gen(function*() {
      const manifest = yield* loadManifest(source, baseUrl)
      const result = yield* CritManifest.sync(
        manifest,
        Option.match(canvas, {
          onNone: () => ({}),
          onSome: (canvasId) => ({ canvasId })
        })
      )
      const output = json
        ? JSON.stringify({ ...result, command: "sync", source })
        : [
            `Synced manifest "${result.manifestId}".`,
            ...result.canvases.map(
              (item) =>
                `  ${item.action.padEnd(9)} ${item.id}  r${item.revision}  +${item.addedFrameIds.length} ~${item.updatedFrameIds.length}`
            )
          ].join("\n")
      yield* writeStdout(`${output}\n`)
    })
).pipe(
  Command.withDescription(
    "Discover manifest Frames and reconcile them into local Canvases"
  )
)

const createCommand = Command.make(
  "create",
  {
    id: Argument.string("id"),
    title: Flag.string("title"),
    json: Flag.boolean("json")
  },
  ({ id, title, json }) =>
    Effect.gen(function*() {
      const runtime = yield* CritRuntime
      const canvas = yield* runtime.createCanvas({ id, title })
      const output = json
        ? JSON.stringify({
            schemaVersion: 1,
            command: "create",
            canvas
          })
        : `Created Canvas "${canvas.title}" (${canvas.id}).`
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("Create an empty Crit Canvas"))

const normalizeUrl = (input: string) =>
  Effect.try({
    try: () => {
      const trimmed = input.trim()
      const url = new URL(
        /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      )
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS URLs can be added")
      }
      url.hash = ""
      return url
    },
    catch: (cause) =>
      new InvalidCliInput({
        detail: cause instanceof Error ? cause.message : String(cause)
      })
  })

const frameIdBase = (url: string) => {
  let hash = 2166136261
  for (const character of url) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `url-${(hash >>> 0).toString(36)}`
}

const allocateFrameId = (used: Set<string>, url: string) => {
  const base = frameIdBase(url)
  let id = base
  let suffix = 2
  while (used.has(`shape:${id}`)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  used.add(`shape:${id}`)
  return id
}

const addCommand = Command.make(
  "add",
  {
    id: Argument.string("canvas"),
    urls: Argument.string("url").pipe(Argument.variadic({ min: 1 })),
    expectedRevision: Flag.integer("expected-revision").pipe(Flag.optional),
    json: Flag.boolean("json")
  },
  ({ id, urls, expectedRevision, json }) =>
    Effect.gen(function*() {
      const runtime = yield* CritRuntime
      const current = yield* runtime.getCanvas(id)
      const usedIds = new Set(current.frames.map((frame) => frame.id))
      const normalized = yield* Effect.forEach(urls, normalizeUrl)
      const commands = normalized.map((url) =>
        CanvasCommand.addFrame({
          id: allocateFrameId(usedIds, url.toString()),
          url: url.toString(),
          title: url.hostname.replace(/^www\./, "") || url.toString(),
          provenance: { kind: "agent", sourceId: "crit-cli:add" }
        })
      )
      const mutation = yield* runtime.updateCanvas({
        id,
        expectedRevision: Option.getOrElse(
          expectedRevision,
          () => current.canvas.revision
        ),
        commands
      })
      const updated = yield* runtime.getCanvas(id)
      const output = json
        ? JSON.stringify({
            schemaVersion: 1,
            command: "add",
            mutation,
            frames: updated.frames
          })
        : `Added ${commands.length} Frame(s) to "${updated.canvas.title}" at revision ${mutation.revision}.`
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("Add one or more live URLs to a Crit Canvas"))

const listCommand = Command.make(
  "list",
  { json: Flag.boolean("json") },
  ({ json }) =>
    Effect.gen(function*() {
      const runtime = yield* CritRuntime
      const canvases = yield* runtime.listCanvases()
      const output = json
        ? JSON.stringify({ schemaVersion: 1, command: "list", canvases })
        : canvases.length === 0
          ? "No local Canvases yet."
          : canvases
              .map(
                (canvas) =>
                  `${canvas.id.padEnd(24)} ${String(canvas.frameCount).padStart(3)} Frame(s)  r${canvas.revision}`
              )
              .join("\n")
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("List local Crit Canvases"))

const openCommand = Command.make(
  "open",
  {
    id: Argument.string("canvas"),
    json: Flag.boolean("json")
  },
  ({ id, json }) =>
    Effect.gen(function*() {
      const runtime = yield* CritRuntime
      const view = yield* runtime.getCanvas(id)
      const output = json
        ? JSON.stringify({ schemaVersion: 1, command: "open", ...view })
        : `Canvas "${view.canvas.title}" (${view.canvas.id}), revision ${view.canvas.revision}, ${view.canvas.frameCount} Frame(s).`
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("Read a Crit Canvas and its Frames"))

export const critCommand = Command.make("crit").pipe(
  Command.withDescription("Arrange and assess live web iterations"),
  Command.withSubcommands([
    initCommand,
    syncCommand,
    createCommand,
    addCommand,
    listCommand,
    openCommand
  ])
)

export const runCrit = (args: ReadonlyArray<string>) =>
  Command.runWith(critCommand, { version: PACKAGE_VERSION })(args)
