import {
  CanvasCommand,
  type CanvasCommand as CanvasCommandValue,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry
} from "../core/index.js"

export const FRAME_SIZE_PRESETS = [
  { id: "mobile", label: "Mobile", width: 402, height: 874 },
  { id: "tablet", label: "Tablet", width: 832, height: 1194 },
  { id: "laptop", label: "Laptop", width: 1280, height: 832 },
  { id: "desktop", label: "Desktop", width: 1512, height: 982 },
  { id: "widescreen", label: "Widescreen", width: 2560, height: 1440 }
] as const

export type FrameSizePreset = (typeof FRAME_SIZE_PRESETS)[number]

const FRAME_GAP = 40

type DuplicateInput = {
  readonly document: CanvasDocument
  readonly sourceId: string
  readonly createId: () => string
}

const liveSource = (document: CanvasDocument, sourceId: string) => {
  const source = document.frames.find((frame) => frame.id === sourceId)
  if (source === undefined || source.snapshot !== undefined) {
    throw new TypeError(`Live Frame not found: ${sourceId}`)
  }
  return source
}

const sameSize = (
  geometry: CanvasGeometry,
  preset: FrameSizePreset
) => geometry.width === preset.width && geometry.height === preset.height

const comparableUrl = (value: string) => {
  try {
    const url = new URL(value)
    url.hash = ""
    return url.toString()
  } catch {
    return value.replace(/#.*$/, "")
  }
}

const overlapsWithGap = (
  left: CanvasGeometry,
  right: CanvasGeometry
) =>
  left.y < right.y + right.height &&
  left.y + left.height > right.y &&
  left.x < right.x + right.width + FRAME_GAP &&
  left.x + left.width + FRAME_GAP > right.x

const arrangeDuplicates = (
  document: CanvasDocument,
  source: CanvasFrame,
  presets: ReadonlyArray<FrameSizePreset>,
  createId: () => string
) => {
  const usedIds = new Set([
    ...document.frames.map((frame) => frame.id),
    ...document.notes.map((note) => note.id),
    ...document.comments.map((thread) => thread.id)
  ])
  const idForCopy = () => {
    let id = createId()
    while (usedIds.has(id)) id = createId()
    usedIds.add(id)
    return id
  }
  const left = presets
    .filter((preset) => preset.width < source.geometry.width)
    .sort((a, b) => b.width - a.width)
  const right = presets
    .filter((preset) => preset.width >= source.geometry.width)
    .sort((a, b) => a.width - b.width)
  const placements: Array<{
    readonly id: string
    readonly preset: FrameSizePreset
    readonly geometry: CanvasGeometry
    readonly direction: "left" | "right"
  }> = []
  let leftEdge = source.geometry.x
  for (const preset of left) {
    leftEdge -= FRAME_GAP + preset.width
    placements.push({
      id: idForCopy(),
      preset,
      direction: "left",
      geometry: {
        x: leftEdge,
        y: source.geometry.y,
        width: preset.width,
        height: preset.height
      }
    })
  }
  let rightEdge = source.geometry.x + source.geometry.width
  for (const preset of right) {
    const x = rightEdge + FRAME_GAP
    placements.push({
      id: idForCopy(),
      preset,
      direction: "right",
      geometry: {
        x,
        y: source.geometry.y,
        width: preset.width,
        height: preset.height
      }
    })
    rightEdge = x + preset.width
  }

  const movable = new Map(
    document.frames
      .filter((frame) => frame.id !== source.id)
      .map((frame) => [frame.id, { ...frame.geometry }])
  )
  const moved = new Set<string>()
  const push = (
    id: string,
    blocker: CanvasGeometry,
    direction: "left" | "right"
  ) => {
    const geometry = movable.get(id)!
    geometry.x = direction === "left"
      ? blocker.x - FRAME_GAP - geometry.width
      : blocker.x + blocker.width + FRAME_GAP
    moved.add(id)
    for (const [otherId, other] of movable) {
      if (otherId !== id && overlapsWithGap(geometry, other)) {
        push(otherId, geometry, direction)
      }
    }
  }
  for (const placement of placements) {
    for (const [id, geometry] of movable) {
      if (overlapsWithGap(placement.geometry, geometry)) {
        push(id, placement.geometry, placement.direction)
      }
    }
  }

  const commands: Array<CanvasCommandValue> = []
  for (const frame of document.frames) {
    const geometry = movable.get(frame.id)
    if (geometry !== undefined && moved.has(frame.id)) {
      commands.push(CanvasCommand.moveFrame({
        id: frame.id,
        x: geometry.x,
        y: geometry.y
      }))
    }
  }
  for (const placement of placements) {
    commands.push(
      CanvasCommand.addFrame({
        id: placement.id,
        url: source.url,
        title: source.title,
        status: source.status === "archived" ? "in-progress" : source.status,
        provenance: { kind: "manual", sourceId: source.id }
      }),
      CanvasCommand.moveFrame({
        id: placement.id,
        x: placement.geometry.x,
        y: placement.geometry.y
      }),
      CanvasCommand.resizeFrame({
        id: placement.id,
        width: placement.preset.width,
        height: placement.preset.height
      })
    )
  }
  return commands
}

export const duplicateFrameAtPreset = (
  input: DuplicateInput & { readonly preset: FrameSizePreset }
) => arrangeDuplicates(
  input.document,
  liveSource(input.document, input.sourceId),
  [input.preset],
  input.createId
)

export const completeFrameBreakpointSet = (input: DuplicateInput) => {
  const source = liveSource(input.document, input.sourceId)
  const sourceUrl = comparableUrl(source.url)
  const missing = FRAME_SIZE_PRESETS.filter((preset) =>
    !input.document.frames.some((frame) =>
      frame.snapshot === undefined &&
      comparableUrl(frame.url) === sourceUrl &&
      sameSize(frame.geometry, preset)
    )
  )
  return arrangeDuplicates(input.document, source, missing, input.createId)
}
