import { Effect, FileSystem, Option, Path, Schema, Stdio, Stream } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import {
  Canvas,
  CanvasCommand,
  CanvasCommandSchema,
  type CanvasCommand as CanvasCommandInput,
  type CanvasDocument
} from "../core/index.js"
import {
  CRIT_MANIFEST_FILE,
  CRIT_MANIFEST_PATH,
  CritManifest,
  CritManifestInvalid
} from "../discovery/index.js"
import { CritInitFailed, CritInitializer } from "../init/project-initializer.js"
import { AgentActivityStore } from "../runtime/agent-activity.js"
import {
  CanvasRepository,
  type CanvasRepositoryMutation
} from "../runtime/canvas-repository.js"
import { SnapshotService } from "../runtime/snapshot-service.js"
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

const pulseAgentActivity = (
  canvasId: string,
  detail: string,
  activeForSeconds = 20
) =>
  Effect.serviceOption(AgentActivityStore).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (activity) =>
          activity
            .signal({ canvasId, activeForSeconds, detail })
            .pipe(Effect.catch(() => Effect.void), Effect.asVoid)
      })
    )
  )

const canvasView = (document: CanvasDocument) => {
  const canvas = Canvas.fromDocument(document)
  return {
    canvas: Canvas.summarize(canvas),
    frames: Canvas.listFrames(canvas),
    notes: Canvas.listNotes(canvas),
    owner: document.owner,
    comments: Canvas.listCommentThreads(canvas)
  }
}

const canvasMutation = (mutation: CanvasRepositoryMutation) => ({
  revision: mutation.document.revision,
  change: mutation.change,
  canvas: Canvas.summarize(Canvas.fromDocument(mutation.document))
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
      yield* Effect.forEach(result.canvases, (item) =>
        pulseAgentActivity(item.id, "Syncing manifest")
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

const decodeCanvasCommands = (input: string) =>
  Effect.try({
    try: () => JSON.parse(input) as unknown,
    catch: (cause) =>
      new InvalidCliInput({
        detail: `Commands must be valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
      })
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CanvasCommandSchema))),
    Effect.mapError((cause) =>
      cause instanceof InvalidCliInput
        ? cause
        : new InvalidCliInput({ detail: `Invalid Canvas commands: ${String(cause)}` })
    ),
    Effect.flatMap((decoded) =>
      decoded.some((command) => command._tag === "AddSnapshotFrame")
        ? Effect.fail(
            new InvalidCliInput({
              detail:
                "AddSnapshotFrame is reserved for snapshot capture; use `crit snapshot <canvas> <frame>` to archive an existing live Frame"
            })
          )
        : Effect.succeed(decoded)
    )
  )

const applyCommand = Command.make(
  "apply",
  {
    id: Argument.string("canvas"),
    commands: Argument.string("commands"),
    json: Flag.boolean("json")
  },
  ({ id, commands, json }) =>
    Effect.gen(function*() {
      const documents = yield* CanvasRepository
      yield* pulseAgentActivity(id, "Applying Canvas edits")
      const decoded: ReadonlyArray<CanvasCommandInput> =
        yield* decodeCanvasCommands(commands)
      if (decoded.length === 0) {
        return yield* new InvalidCliInput({
          detail: "At least one Canvas command is required"
        })
      }
      const persisted = yield* documents.apply(id, decoded)
      const mutation = canvasMutation(persisted)
      const updated = canvasView(persisted.document)
      const output = json
        ? JSON.stringify({
            schemaVersion: 1,
            command: "apply",
            mutation,
            frames: updated.frames,
            notes: updated.notes,
            owner: updated.owner,
            comments: updated.comments
          })
        : `Applied ${decoded.length} command(s) to "${updated.canvas.title}" at revision ${mutation.revision}.`
      yield* writeStdout(`${output}\n`)
    })
).pipe(
  Command.withDescription(
    "Atomically apply semantic Frame, Note, and Comment commands"
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
      const documents = yield* CanvasRepository
      const created = Canvas.create({ id, title })
      const canvas = Canvas.summarize(created)
      yield* documents.create(Canvas.export(created))
      yield* pulseAgentActivity(id, "Created Canvas")
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
  while (used.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  used.add(id)
  return id
}

const addCommand = Command.make(
  "add",
  {
    id: Argument.string("canvas"),
    urls: Argument.string("url").pipe(Argument.variadic({ min: 1 })),
    json: Flag.boolean("json")
  },
  ({ id, urls, json }) =>
    Effect.gen(function*() {
      const documents = yield* CanvasRepository
      yield* pulseAgentActivity(id, "Adding Frames")
      const current = canvasView(yield* documents.load(id))
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
      const persisted = yield* documents.apply(id, commands)
      const mutation = canvasMutation(persisted)
      const updated = canvasView(persisted.document)
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
      const documents = yield* CanvasRepository
      const canvases = (yield* documents.list()).map((document) =>
        Canvas.summarize(Canvas.fromDocument(document))
      )
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
      const documents = yield* CanvasRepository
      yield* pulseAgentActivity(id, "Reading Canvas")
      const view = canvasView(yield* documents.load(id))
      const output = json
        ? JSON.stringify({ schemaVersion: 1, command: "open", ...view })
        : `Canvas "${view.canvas.title}" (${view.canvas.id}), revision ${view.canvas.revision}, ${view.canvas.frameCount} Frame(s).`
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("Read a Crit Canvas, Frames, Notes, and Comments"))

const snapshotCommand = Command.make(
  "snapshot",
  {
    canvas: Argument.string("canvas"),
    frame: Argument.string("frame"),
    json: Flag.boolean("json")
  },
  ({ canvas, frame, json }) =>
    Effect.gen(function*() {
      const snapshots = Option.getOrUndefined(
        yield* Effect.serviceOption(SnapshotService)
      )
      if (snapshots === undefined) {
        return yield* new InvalidCliInput({
          detail: "Snapshot capture is unavailable in this Crit runtime"
        })
      }
      yield* pulseAgentActivity(canvas, "Capturing Frame snapshot", 120)
      const document = yield* snapshots.snapshotFrame(canvas, frame)
      const archived = [...document.frames].reverse().find(
        (candidate) =>
          candidate.snapshot !== undefined &&
          candidate.provenance.kind === "snapshot" &&
          candidate.provenance.sourceId === frame
      )
      if (archived?.snapshot === undefined) {
        return yield* new InvalidCliInput({
          detail: `Snapshot capture did not add an archived Frame for ${frame}`
        })
      }
      const output = json
        ? JSON.stringify({
            schemaVersion: 1,
            command: "snapshot",
            canvasId: canvas,
            frame: archived
          })
        : `Archived Frame "${frame}" as "${archived.id}" (${archived.snapshot.sizeBytes} bytes).`
      yield* writeStdout(`${output}\n`)
    })
).pipe(
  Command.withDescription(
    "Capture a live Frame as an immutable self-contained HTML archive"
  )
)

const activityCommand = Command.make(
  "activity",
  {
    canvas: Argument.string("canvas"),
    activeForSeconds: Flag.integer("for").pipe(Flag.withDefault(120)),
    clear: Flag.boolean("clear"),
    detail: Flag.string("detail").pipe(Flag.optional),
    json: Flag.boolean("json")
  },
  ({ canvas, activeForSeconds, clear, detail, json }) =>
    Effect.gen(function*() {
      const activity = Option.getOrUndefined(
        yield* Effect.serviceOption(AgentActivityStore)
      )
      if (activity === undefined) {
        return yield* new InvalidCliInput({
          detail: "Agent activity is unavailable in this Crit runtime"
        })
      }
      const status = clear
        ? yield* activity.clear(canvas)
        : yield* activity.signal({
            canvasId: canvas,
            activeForSeconds,
            ...Option.match(detail, {
              onNone: () => ({}),
              onSome: (value) => ({ detail: value })
            })
          })
      const output = json
        ? JSON.stringify({ schemaVersion: 1, command: "activity", activity: status })
        : status.active
          ? `Agent activity is visible on "${canvas}" until ${status.activeUntil}.`
          : `Agent activity cleared for "${canvas}".`
      yield* writeStdout(`${output}\n`)
    })
).pipe(
  Command.withDescription(
    "Signal or clear renewable local agent activity for a Canvas"
  )
)

export const critCommand = Command.make("crit").pipe(
  Command.withDescription("Arrange and assess live web iterations"),
  Command.withSubcommands([
    initCommand,
    syncCommand,
    applyCommand,
    createCommand,
    addCommand,
    snapshotCommand,
    activityCommand,
    listCommand,
    openCommand
  ])
)

export const runCrit = (args: ReadonlyArray<string>) =>
  Command.runWith(critCommand, { version: PACKAGE_VERSION })(args)
