import type { CanvasGeometry } from "../core/index.js"

export const NOTE_FRAME_CLEARANCE = 20

const coordinateTolerance = (left: number, right: number) =>
  Math.max(1, Math.abs(left), Math.abs(right)) * Number.EPSILON * 16

const atMost = (left: number, right: number) =>
  left <= right + coordinateTolerance(left, right)

const atLeast = (left: number, right: number) =>
  left + coordinateTolerance(left, right) >= right

const isClearOf = (
  note: CanvasGeometry,
  frame: CanvasGeometry,
  clearance: number
) =>
  atMost(note.x + note.width, frame.x - clearance) ||
  atLeast(note.x, frame.x + frame.width + clearance) ||
  atMost(note.y + note.height, frame.y - clearance) ||
  atLeast(note.y, frame.y + frame.height + clearance)

const isClearOfEveryFrame = (
  note: CanvasGeometry,
  frames: ReadonlyArray<CanvasGeometry>,
  clearance: number
) => frames.every((frame) => isClearOf(note, frame, clearance))

const unique = (values: ReadonlyArray<number>) => [...new Set(values)]

type ClearanceSide = "left" | "right" | "top" | "bottom"

interface PreferredClearanceSide {
  readonly side: ClearanceSide
  readonly distance: number
}

const preferredSide = (
  anchor: CanvasGeometry,
  frame: CanvasGeometry,
  clearance: number
): PreferredClearanceSide => {
  // Once a Note has been placed beside a Frame, growing it must preserve that
  // horizontal relationship. A zoom-dependent Frame shell can otherwise make
  // the same diagonal anchor appear marginally closer to the bottom edge and
  // flip the projection axis for a frame before flipping back.
  if (anchor.x + anchor.width <= frame.x) {
    return { side: "left", distance: frame.x - anchor.x - anchor.width }
  }
  if (anchor.x >= frame.x + frame.width) {
    return {
      side: "right",
      distance: anchor.x - frame.x - frame.width
    }
  }
  if (anchor.y + anchor.height <= frame.y) {
    return { side: "top", distance: frame.y - anchor.y - anchor.height }
  }
  if (anchor.y >= frame.y + frame.height) {
    return {
      side: "bottom",
      distance: anchor.y - frame.y - frame.height
    }
  }

  return [
    {
      side: "left" as const,
      distance: Math.abs(
        anchor.x - (frame.x - clearance - anchor.width)
      )
    },
    {
      side: "right" as const,
      distance: Math.abs(
        anchor.x - (frame.x + frame.width + clearance)
      )
    },
    {
      side: "top" as const,
      distance: Math.abs(
        anchor.y - (frame.y - clearance - anchor.height)
      )
    },
    {
      side: "bottom" as const,
      distance: Math.abs(
        anchor.y - (frame.y + frame.height + clearance)
      )
    }
  ].sort((left, right) => left.distance - right.distance)[0]!
}

const isOnSide = (
  note: CanvasGeometry,
  frame: CanvasGeometry,
  side: ClearanceSide,
  clearance: number
) => side === "left"
  ? atMost(note.x + note.width, frame.x - clearance)
  : side === "right"
    ? atLeast(note.x, frame.x + frame.width + clearance)
    : side === "top"
      ? atMost(note.y + note.height, frame.y - clearance)
      : atLeast(note.y, frame.y + frame.height + clearance)

/**
 * Projects a zoom-responsive Note outside every visible Frame shell.
 * Candidate edges are derived from Frame edges so the nearest valid result
 * grows away from the Frame instead of through it.
 */
export const noteFrameClearance = ({
  geometry,
  anchor = geometry,
  frames,
  zoom
}: {
  readonly anchor?: CanvasGeometry
  readonly geometry: CanvasGeometry
  readonly frames: ReadonlyArray<CanvasGeometry>
  readonly zoom: number
}): CanvasGeometry => {
  if (frames.length === 0) return geometry
  const clearance = NOTE_FRAME_CLEARANCE / Math.max(zoom, Number.EPSILON)
  if (isClearOfEveryFrame(geometry, frames, clearance)) return geometry
  const obstruction = frames
    .filter((frame) => !isClearOf(geometry, frame, clearance))
    .map((frame) => ({ frame, preference: preferredSide(anchor, frame, clearance) }))
    .sort((left, right) =>
      left.preference.distance - right.preference.distance
    )[0]!

  const candidateX = unique([
    geometry.x,
    ...frames.flatMap((frame) => [
      frame.x - clearance - geometry.width,
      frame.x + frame.width + clearance
    ])
  ])
  const candidateY = unique([
    geometry.y,
    ...frames.flatMap((frame) => [
      frame.y - clearance - geometry.height,
      frame.y + frame.height + clearance
    ])
  ])
  const candidates = [
    ...candidateX.map((x) => ({ ...geometry, x })),
    ...candidateY
      .filter((y) => y !== geometry.y)
      .map((y) => ({ ...geometry, y }))
  ].filter((candidate) =>
    isClearOfEveryFrame(candidate, frames, clearance)
  )

  const directionalCandidates = candidates.filter((candidate) => isOnSide(
    candidate,
    obstruction.frame,
    obstruction.preference.side,
    clearance
  ))
  return (directionalCandidates.length > 0
    ? directionalCandidates
    : candidates).sort((left, right) => {
    const leftX = left.x - geometry.x
    const leftY = left.y - geometry.y
    const rightX = right.x - geometry.x
    const rightY = right.y - geometry.y
    return leftX ** 2 + leftY ** 2 - (rightX ** 2 + rightY ** 2) ||
      Math.abs(leftX) + Math.abs(leftY) - Math.abs(rightX) - Math.abs(rightY) ||
      left.y - right.y ||
      left.x - right.x
  })[0] ?? geometry
}
