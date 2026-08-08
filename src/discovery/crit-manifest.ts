import { Effect, Schema } from "effect"

import {
  CanvasCommand,
  CanvasCommandFailed,
  CanvasDocumentTooLarge,
  FrameDisplay,
  FrameReviewStatus,
  type CanvasCommand as CanvasCommandInput,
  type FrameSummary
} from "../core/index.js"
import {
  DocumentMalformed,
  DocumentNotFound,
  DocumentStorageFailed
} from "../runtime/canvas-repository.js"
import {
  CritRuntime,
  type CritRuntimeShape
} from "../runtime/crit-runtime.js"

export const CRIT_MANIFEST_PATH = "/.well-known/crit.json"
export const CRIT_MANIFEST_FILE = "crit.manifest.json"

export const CritManifestGeometry = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThan(0)),
  height: Schema.Finite.check(Schema.isGreaterThan(0))
})
export type CritManifestGeometry = typeof CritManifestGeometry.Type

export const CritManifestFrame = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  status: Schema.optional(FrameReviewStatus),
  display: Schema.optional(FrameDisplay),
  geometry: Schema.optional(CritManifestGeometry)
})
export type CritManifestFrame = typeof CritManifestFrame.Type

export const CritManifestCanvas = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  frames: Schema.Array(CritManifestFrame)
})
export type CritManifestCanvas = typeof CritManifestCanvas.Type

export const CritManifestDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  canvases: Schema.Array(CritManifestCanvas)
})
export type CritManifestDocument = typeof CritManifestDocument.Type

export type ResolvedCritManifestFrame = Omit<CritManifestFrame, "url"> & {
  readonly url: string
}

export type ResolvedCritManifestCanvas = Omit<CritManifestCanvas, "frames"> & {
  readonly frames: ReadonlyArray<ResolvedCritManifestFrame>
}

export type ResolvedCritManifest = Omit<CritManifestDocument, "canvases"> & {
  readonly canvases: ReadonlyArray<ResolvedCritManifestCanvas>
}

export type CritManifestCanvasSync = {
  readonly id: string
  readonly action: "created" | "updated" | "unchanged"
  readonly revision: number
  readonly addedFrameIds: ReadonlyArray<string>
  readonly updatedFrameIds: ReadonlyArray<string>
  readonly unchangedFrameIds: ReadonlyArray<string>
}

export type CritManifestSyncResult = {
  readonly schemaVersion: 1
  readonly manifestId: string
  readonly canvases: ReadonlyArray<CritManifestCanvasSync>
}

export type CritManifestSyncError =
  | CritManifestInvalid
  | DocumentNotFound
  | DocumentMalformed
  | DocumentStorageFailed
  | CanvasCommandFailed
  | CanvasDocumentTooLarge

export class CritManifestInvalid extends Schema.TaggedError<CritManifestInvalid>()(
  "CritManifestInvalid",
  {
    source: Schema.String,
    detail: Schema.String
  }
) {}

const invalid = (source: string, detail: string) =>
  new CritManifestInvalid({ source, detail })

const assertIdentifier = (value: string, label: string, source: string) => {
  if (value.trim().length === 0) throw invalid(source, `${label} cannot be empty`)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw invalid(
      source,
      `${label} must contain only letters, numbers, dots, underscores, and hyphens`
    )
  }
}

const validate = (manifest: CritManifestDocument, source: string) =>
  Effect.try({
    try: () => {
      assertIdentifier(manifest.id, "Manifest ID", source)
      const canvasIds = new Set<string>()
      for (const canvas of manifest.canvases) {
        assertIdentifier(canvas.id, "Canvas ID", source)
        if (canvas.title.trim().length === 0) {
          throw invalid(source, `Canvas ${canvas.id} must have a title`)
        }
        if (canvasIds.has(canvas.id)) {
          throw invalid(source, `Duplicate Canvas ID: ${canvas.id}`)
        }
        canvasIds.add(canvas.id)

        const frameIds = new Set<string>()
        for (const frame of canvas.frames) {
          assertIdentifier(frame.id, `Frame ID in ${canvas.id}`, source)
          if (frame.title.trim().length === 0) {
            throw invalid(source, `Frame ${canvas.id}/${frame.id} must have a title`)
          }
          if (frameIds.has(frame.id)) {
            throw invalid(
              source,
              `Duplicate Frame ID in Canvas ${canvas.id}: ${frame.id}`
            )
          }
          frameIds.add(frame.id)
        }
      }
      return manifest
    },
    catch: (cause) =>
      cause instanceof CritManifestInvalid
        ? cause
        : invalid(source, cause instanceof Error ? cause.message : String(cause))
  })

const decode = (input: unknown, source = "manifest") =>
  Schema.decodeUnknownEffect(CritManifestDocument)(input).pipe(
    Effect.mapError((cause) => invalid(source, String(cause))),
    Effect.flatMap((manifest) => validate(manifest, source))
  )

const absoluteHttpUrl = (value: string, baseUrl: string, source: string) =>
  Effect.try({
    try: () => {
      const base = new URL(baseUrl)
      const url = new URL(value, new URL("/", base))
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Only HTTP and HTTPS frame URLs are supported: ${value}`)
      }
      url.hash = ""
      return url.toString()
    },
    catch: (cause) =>
      invalid(source, cause instanceof Error ? cause.message : String(cause))
  })

const resolve = (
  input: unknown,
  options: { readonly baseUrl: string; readonly source?: string }
): Effect.Effect<ResolvedCritManifest, CritManifestInvalid> =>
  Effect.gen(function*() {
    const source = options.source ?? options.baseUrl
    const manifest = yield* decode(input, source)
    const canvases = yield* Effect.forEach(manifest.canvases, (canvas) =>
      Effect.gen(function*() {
        const frames = yield* Effect.forEach(canvas.frames, (frame) =>
          absoluteHttpUrl(frame.url, options.baseUrl, source).pipe(
            Effect.map(
              (url): ResolvedCritManifestFrame => ({
                ...frame,
                url
              })
            )
          )
        )
        return { ...canvas, frames }
      })
    )
    return { ...manifest, canvases }
  })

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

const planFrameCommands = (
  manifest: ResolvedCritManifest,
  canvas: ResolvedCritManifestCanvas,
  current: ReadonlyArray<FrameSummary>
) => {
  const byId = new Map(current.map((frame) => [frame.id, frame]))
  const commands: Array<CanvasCommandInput> = []
  const addedFrameIds: Array<string> = []
  const updatedFrameIds: Array<string> = []
  const unchangedFrameIds: Array<string> = []

  for (const frame of canvas.frames) {
    const commandCountBefore = commands.length
    const id = frame.id
    const existing = byId.get(id)
    const provenance = {
      kind: "manifest" as const,
      sourceId: `${manifest.id}:${canvas.id}:${frame.id}`
    }

    if (existing === undefined) {
      commands.push(
        CanvasCommand.addFrame({
          id: frame.id,
          url: frame.url,
          title: frame.title,
          ...(frame.status === undefined ? {} : { status: frame.status }),
          provenance
        })
      )
      if (
        frame.display !== undefined &&
        frame.display.heightMode !== "viewport"
      ) {
        commands.push(
          CanvasCommand.updateFrame({
            id: frame.id,
            changes: { display: frame.display }
          })
        )
      }
      if (frame.geometry !== undefined) {
        commands.push(
          CanvasCommand.moveFrame({
            id: frame.id,
            x: frame.geometry.x,
            y: frame.geometry.y
          }),
          CanvasCommand.resizeFrame({
            id: frame.id,
            width: frame.geometry.width,
            height: frame.geometry.height
          })
        )
      }
      addedFrameIds.push(id)
      continue
    }

    const changes = {
      ...(existing.url === frame.url ? {} : { url: frame.url }),
      ...(existing.title === frame.title ? {} : { title: frame.title }),
      ...(frame.status === undefined || existing.status === frame.status
        ? {}
        : { status: frame.status }),
      ...(same(existing.provenance, provenance) ? {} : { provenance }),
      ...(frame.display === undefined || same(existing.display, frame.display)
        ? {}
        : { display: frame.display })
    }
    if (Object.keys(changes).length > 0) {
      commands.push(CanvasCommand.updateFrame({ id: frame.id, changes }))
    }
    if (
      frame.geometry !== undefined &&
      (existing.geometry.x !== frame.geometry.x ||
        existing.geometry.y !== frame.geometry.y)
    ) {
      commands.push(
        CanvasCommand.moveFrame({
          id: frame.id,
          x: frame.geometry.x,
          y: frame.geometry.y
        })
      )
    }
    if (
      frame.geometry !== undefined &&
      (existing.geometry.width !== frame.geometry.width ||
        existing.geometry.height !== frame.geometry.height)
    ) {
      commands.push(
        CanvasCommand.resizeFrame({
          id: frame.id,
          width: frame.geometry.width,
          height: frame.geometry.height
        })
      )
    }

    if (commands.length > commandCountBefore) {
      updatedFrameIds.push(id)
    } else {
      unchangedFrameIds.push(id)
    }
  }

  return { commands, addedFrameIds, updatedFrameIds, unchangedFrameIds }
}

const syncWith = (
  runtime: CritRuntimeShape,
  manifest: ResolvedCritManifest,
  options: { readonly canvasId?: string } = {}
) => {
  const selected =
    options.canvasId === undefined
      ? manifest.canvases
      : manifest.canvases.filter((canvas) => canvas.id === options.canvasId)
  if (options.canvasId !== undefined && selected.length === 0) {
    return Effect.fail(
      invalid(
        manifest.id,
        `Manifest does not define Canvas ${options.canvasId}`
      )
    )
  }

  const syncCanvas = (
    canvas: ResolvedCritManifestCanvas
  ): Effect.Effect<CritManifestCanvasSync, CritManifestSyncError> =>
    Effect.gen(function*() {
      let created = false
      const current = yield* runtime.getCanvas(canvas.id).pipe(
        Effect.catchTag("DocumentNotFound", () =>
          runtime.createCanvas({ id: canvas.id, title: canvas.title }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                created = true
              })
            ),
            Effect.catchTag("DocumentAlreadyExists", () => Effect.void),
            Effect.andThen(runtime.getCanvas(canvas.id))
          )
        )
      )
      const plan = planFrameCommands(manifest, canvas, current.frames)
      if (plan.commands.length === 0) {
        return {
          id: canvas.id,
          action: created ? "created" as const : "unchanged" as const,
          revision: current.canvas.revision,
          addedFrameIds: plan.addedFrameIds,
          updatedFrameIds: plan.updatedFrameIds,
          unchangedFrameIds: plan.unchangedFrameIds
        }
      }

      const mutation = yield* runtime.updateCanvas({
        id: canvas.id,
        commands: plan.commands
      })
      return {
        id: canvas.id,
        action: created ? "created" as const : "updated" as const,
        revision: mutation.revision,
        addedFrameIds: plan.addedFrameIds,
        updatedFrameIds: plan.updatedFrameIds,
        unchangedFrameIds: plan.unchangedFrameIds
      }
    })

  return Effect.forEach(selected, (canvas) => syncCanvas(canvas)).pipe(
    Effect.map(
      (canvases): CritManifestSyncResult => ({
        schemaVersion: 1,
        manifestId: manifest.id,
        canvases
      })
    )
  )
}

const sync = (
  manifest: ResolvedCritManifest,
  options: { readonly canvasId?: string } = {}
) => Effect.flatMap(CritRuntime, (runtime) => syncWith(runtime, manifest, options))

export const CritManifest = {
  decode,
  resolve,
  sync
} as const
