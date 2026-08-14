import { Effect, Schema } from "effect"

import {
  Canvas,
  CanvasCommand,
  FrameDisplay,
  FrameReviewStatus,
  type Author,
  type CanvasCommand as CanvasCommandInput,
  type CanvasFrame
} from "../core/index.js"
import {
  CritClientCommandFailed,
  CritClientInvalidDocument,
  CritClientNotFound,
  CritClientUnavailable
} from "../runtime/canvas-failure.js"
import { CanvasRepository } from "../runtime/canvas-repository.js"

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
export type CritManifestInput = Schema.Json | CritManifestDocument

export type CritManifestField<A> =
  | { readonly _tag: "Unmanaged" }
  | { readonly _tag: "Managed"; readonly value: A }

export type ResolvedCritManifestFrame = {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly status: CritManifestField<typeof FrameReviewStatus.Type>
  readonly display: CritManifestField<typeof FrameDisplay.Type>
  readonly geometry: CritManifestField<CritManifestGeometry>
}

export type ResolvedCritManifestCanvas = Omit<CritManifestCanvas, "frames"> & {
  readonly frames: ReadonlyArray<ResolvedCritManifestFrame>
}

export type ResolvedCritManifest = Omit<CritManifestDocument, "canvases"> & {
  readonly canvases: ReadonlyArray<ResolvedCritManifestCanvas>
}

const manifestField = <A>(value: A | undefined): CritManifestField<A> =>
  value === undefined
    ? { _tag: "Unmanaged" }
    : { _tag: "Managed", value }

const encodeResolvedFrame = (
  frame: ResolvedCritManifestFrame
): CritManifestFrame => {
  let encoded: CritManifestFrame = {
    id: frame.id,
    url: frame.url,
    title: frame.title
  }
  if (frame.status._tag === "Managed") {
    encoded = { ...encoded, status: frame.status.value }
  }
  if (frame.display._tag === "Managed") {
    encoded = { ...encoded, display: frame.display.value }
  }
  if (frame.geometry._tag === "Managed") {
    encoded = { ...encoded, geometry: frame.geometry.value }
  }
  return encoded
}

const toDocument = (
  manifest: ResolvedCritManifest
): CritManifestDocument => ({
  schemaVersion: manifest.schemaVersion,
  id: manifest.id,
  canvases: manifest.canvases.map((canvas) => ({
    id: canvas.id,
    title: canvas.title,
    frames: canvas.frames.map(encodeResolvedFrame)
  }))
})

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
  | CritClientNotFound
  | CritClientInvalidDocument
  | CritClientUnavailable
  | CritClientCommandFailed

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

const decode = (input: CritManifestInput, source = "manifest") =>
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
  input: CritManifestInput,
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
                id: frame.id,
                url,
                title: frame.title,
                status: manifestField(frame.status),
                display: manifestField(frame.display),
                geometry: manifestField(frame.geometry)
              })
            )
          )
        )
        return { ...canvas, frames }
      })
    )
    return { ...manifest, canvases }
  })

const planFrameCommands = (
  manifest: ResolvedCritManifest,
  canvas: ResolvedCritManifestCanvas,
  current: ReadonlyArray<CanvasFrame>
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
      const status = frame.status._tag === "Managed"
        ? frame.status.value
        : "in-progress"
      const display = frame.display._tag === "Managed"
        ? frame.display.value
        : { heightMode: "viewport" as const }
      commands.push(
        CanvasCommand.addFrame({
          id: frame.id,
          url: frame.url,
          title: frame.title,
          status,
          provenance
        }),
        CanvasCommand.setFrameDisplay({ id: frame.id, display })
      )
      if (frame.geometry._tag === "Managed") {
        commands.push(
          CanvasCommand.moveFrame({
            id: frame.id,
            x: frame.geometry.value.x,
            y: frame.geometry.value.y
          }),
          CanvasCommand.resizeFrame({
            id: frame.id,
            width: frame.geometry.value.width,
            height: frame.geometry.value.height
          })
        )
      }
      addedFrameIds.push(id)
      continue
    }

    if (
      existing.url !== frame.url ||
      existing.provenance.kind !== provenance.kind ||
      existing.provenance.sourceId !== provenance.sourceId
    ) {
      commands.push(
        CanvasCommand.setFrameSource({
          id,
          url: frame.url,
          provenance
        })
      )
    }
    if (existing.title !== frame.title) {
      commands.push(CanvasCommand.setFrameTitle({ id, title: frame.title }))
    }
    if (
      frame.status._tag === "Managed" &&
      existing.status !== frame.status.value
    ) {
      commands.push(
        CanvasCommand.setFrameStatus({ id, status: frame.status.value })
      )
    }
    if (
      frame.display._tag === "Managed" &&
      existing.display.heightMode !== frame.display.value.heightMode
    ) {
      commands.push(
        CanvasCommand.setFrameDisplay({ id, display: frame.display.value })
      )
    }
    if (
      frame.geometry._tag === "Managed" &&
      (existing.geometry.x !== frame.geometry.value.x ||
        existing.geometry.y !== frame.geometry.value.y)
    ) {
      commands.push(
        CanvasCommand.moveFrame({
          id: frame.id,
          x: frame.geometry.value.x,
          y: frame.geometry.value.y
        })
      )
    }
    if (
      frame.geometry._tag === "Managed" &&
      (existing.geometry.width !== frame.geometry.value.width ||
        existing.geometry.height !== frame.geometry.value.height)
    ) {
      commands.push(
        CanvasCommand.resizeFrame({
          id: frame.id,
          width: frame.geometry.value.width,
          height: frame.geometry.value.height
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
  documents: CanvasRepository["Service"],
  manifest: ResolvedCritManifest,
  options: { readonly owner: Author; readonly canvasId?: string }
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
      const current = yield* documents.load(canvas.id).pipe(
        Effect.catchTag("CritClientNotFound", () =>
          documents.create(
            Canvas.export(
              Canvas.create({
                id: canvas.id,
                title: canvas.title,
                owner: options.owner
              })
            )
          ).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                created = true
              })
            ),
            Effect.catchTag("DocumentAlreadyExists", () => Effect.void),
            Effect.andThen(documents.load(canvas.id))
          )
        )
      )
      const plan = planFrameCommands(
        manifest,
        canvas,
        Canvas.listFrames(Canvas.fromDocument(current))
      )
      if (plan.commands.length === 0) {
        return {
          id: canvas.id,
          action: created ? "created" as const : "unchanged" as const,
          revision: current.revision,
          addedFrameIds: plan.addedFrameIds,
          updatedFrameIds: plan.updatedFrameIds,
          unchangedFrameIds: plan.unchangedFrameIds
        }
      }

      const mutation = yield* documents.apply(canvas.id, plan.commands)
      return {
        id: canvas.id,
        action: created ? "created" as const : "updated" as const,
        revision: mutation.document.revision,
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
  options: { readonly owner: Author; readonly canvasId?: string }
) => Effect.flatMap(CanvasRepository, (documents) =>
  syncWith(documents, manifest, options)
)

export const CritManifest = {
  decode,
  resolve,
  sync,
  toDocument
} as const
