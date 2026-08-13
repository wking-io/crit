import type { CanvasGeometry } from "../core/index.js"

export type FrameSelectionModifiers = {
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
}

export type CanvasSelectionPoint = {
  readonly x: number
  readonly y: number
}

export type CanvasSelectionBox = CanvasSelectionPoint & {
  readonly width: number
  readonly height: number
}

export const selectionBoxBetween = (
  start: CanvasSelectionPoint,
  end: CanvasSelectionPoint
): CanvasSelectionBox => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y)
})

export const frameIdsIntersectingSelectionBox = (
  frames: ReadonlyArray<{
    readonly id: string
    readonly geometry: CanvasGeometry
  }>,
  box: CanvasSelectionBox
): ReadonlySet<string> => new Set(
  frames
    .filter(({ geometry }) =>
      geometry.x <= box.x + box.width &&
      geometry.x + geometry.width >= box.x &&
      geometry.y <= box.y + box.height &&
      geometry.y + geometry.height >= box.y
    )
    .map((frame) => frame.id)
)

export const selectCanvasFramesInBox = (
  current: ReadonlySet<string>,
  intersecting: ReadonlySet<string>,
  additive: boolean
): ReadonlySet<string> => additive
  ? new Set([...current, ...intersecting])
  : new Set(intersecting)

export const isAdditiveFrameSelection = (
  modifiers: FrameSelectionModifiers
): boolean =>
  modifiers.ctrlKey === true ||
  modifiers.metaKey === true ||
  modifiers.shiftKey === true

export const selectCanvasFrame = (
  current: ReadonlySet<string>,
  frameId: string,
  additive: boolean
): ReadonlySet<string> => {
  if (!additive) return new Set([frameId])
  const next = new Set(current)
  if (next.has(frameId)) next.delete(frameId)
  else next.add(frameId)
  return next
}

export const selectCanvasFrameForMove = (
  current: ReadonlySet<string>,
  frameId: string,
  additive: boolean
): ReadonlySet<string> => {
  if (current.has(frameId)) return current
  if (!additive) return new Set([frameId])
  return new Set([...current, frameId])
}
