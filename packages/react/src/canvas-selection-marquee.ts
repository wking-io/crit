import { CanvasSelection, type CanvasItemRef } from "./canvas-selection.js"

export type CanvasSelectionPoint = {
  readonly x: number
  readonly y: number
}

export type CanvasSelectionBox = CanvasSelectionPoint & {
  readonly width: number
  readonly height: number
}

export const MARQUEE_DRAG_THRESHOLD = 3

export const selectionBoxBetween = (
  start: CanvasSelectionPoint,
  end: CanvasSelectionPoint
): CanvasSelectionBox => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y)
})

export const applyMarqueeBox = (
  element: HTMLElement,
  box: CanvasSelectionBox | null
): void => {
  if (box === null) {
    element.hidden = true
    element.style.width = "0px"
    element.style.height = "0px"
    return
  }
  element.hidden = false
  element.style.left = `${box.x}px`
  element.style.top = `${box.y}px`
  element.style.width = `${box.width}px`
  element.style.height = `${box.height}px`
}

export const screenToWorldPoint = (
  point: CanvasSelectionPoint,
  camera: { readonly x: number; readonly y: number; readonly zoom: number }
): CanvasSelectionPoint => ({
  x: (point.x - camera.x) / camera.zoom,
  y: (point.y - camera.y) / camera.zoom
})

const boxesIntersect = (
  box: CanvasSelectionBox,
  geometry: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
): boolean =>
  geometry.x <= box.x + box.width &&
  geometry.x + geometry.width >= box.x &&
  geometry.y <= box.y + box.height &&
  geometry.y + geometry.height >= box.y

export const selectionInWorldBox = (
  items: ReadonlyArray<{
    readonly item: CanvasItemRef
    readonly geometry: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  }>,
  box: CanvasSelectionBox,
  additive: CanvasSelection
): CanvasSelection => {
  const intersecting = items.flatMap(({ item, geometry }) =>
    boxesIntersect(box, geometry) ? [item] : []
  )
  if (additive.length === 0) return CanvasSelection.make(intersecting)
  const seen = new Set(additive.map((item) => item.frameId))
  return CanvasSelection.make([
    ...additive,
    ...intersecting.filter((item) => !seen.has(item.frameId))
  ])
}
