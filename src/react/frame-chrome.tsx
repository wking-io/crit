import type { FrameStatus } from "../core/index.js"
import type { GlyphName } from "../glyphs/index.js"

export interface FrameStatusChrome {
  readonly id: FrameStatus
  readonly label: string
  readonly ink: string
  readonly shell: string
  readonly stroke: string
  readonly glyph: GlyphName
}

export const STATUS_PILL_HEIGHT = 24
export const STATUS_PILL_STEP = 40
const STATUS_PILL_RADIUS = 8
const STATUS_PILL_CHROME_WIDTH = 40
const STATUS_PILL_CHARACTER_WIDTH = 6.5
export const STATUS_PILL_MOTION = {
  spring: { type: "spring", visualDuration: 0.25, bounce: 0.3 },
  curve: -55,
  curveExponent: 1.85,
  originOffset: 38,
  initialScale: 0.5,
  gap: 6,
  frameGap: 6
} as const

let statusPillMeasurementContext: CanvasRenderingContext2D | null

export function measureStatusPillWidth(label: string) {
  if (typeof document === "undefined") {
    return STATUS_PILL_CHROME_WIDTH + label.length * STATUS_PILL_CHARACTER_WIDTH
  }
  statusPillMeasurementContext ??= document
    .createElement("canvas")
    .getContext("2d")
  if (!statusPillMeasurementContext) {
    return STATUS_PILL_CHROME_WIDTH + label.length * STATUS_PILL_CHARACTER_WIDTH
  }
  statusPillMeasurementContext.font =
    "400 12px system-ui, -apple-system, sans-serif"
  return (
    STATUS_PILL_CHROME_WIDTH +
    statusPillMeasurementContext.measureText(label).width
  )
}

const roundedRectangleSupport = (
  width: number,
  height: number,
  radius: number,
  angle: number,
  axisX: number,
  axisY: number
) => {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const localAxisX = cosine * axisX + sine * axisY
  const localAxisY = -sine * axisX + cosine * axisY
  const localSupportX =
    Math.sign(localAxisX) * (width / 2 - radius) + radius * localAxisX
  const localSupportY =
    Math.sign(localAxisY) * (height / 2 - radius) + radius * localAxisY
  return {
    x: cosine * localSupportX - sine * localSupportY,
    y: sine * localSupportX + cosine * localSupportY
  }
}

export interface StatusPillLayoutItem {
  readonly distanceFromFrame: number
  readonly finalRotate: number
  readonly angle: number
  readonly width: number
  readonly verticalHalfExtent: number
  finalX: number
  centerX: number
  centerY: number
  finalY: number
}

export function calculateStatusPillLayout(
  widths: ReadonlyArray<number>
): ReadonlyArray<StatusPillLayoutItem> {
  const layout: Array<StatusPillLayoutItem> = widths.map((width, index) => {
    const distanceFromFrame = widths.length - index
    const curveScale = distanceFromFrame / widths.length
    const curveSlope =
      (STATUS_PILL_MOTION.curve *
        STATUS_PILL_MOTION.curveExponent *
        Math.pow(curveScale, STATUS_PILL_MOTION.curveExponent - 1)) /
      (widths.length * STATUS_PILL_STEP)
    const finalRotate = Math.atan(curveSlope) * (180 / Math.PI)
    const angle = (finalRotate * Math.PI) / 180
    const verticalHalfExtent = roundedRectangleSupport(
      width,
      STATUS_PILL_HEIGHT,
      STATUS_PILL_RADIUS,
      angle,
      0,
      1
    ).y
    return {
      distanceFromFrame,
      finalRotate,
      angle,
      width,
      verticalHalfExtent,
      finalX: 0,
      centerX: 0,
      centerY: 0,
      finalY: 0
    }
  })
  const bottomIndex = layout.length - 1
  const bottomItem = layout[bottomIndex]
  if (bottomItem) {
    bottomItem.finalX =
      STATUS_PILL_MOTION.curve *
      Math.pow(
        bottomItem.distanceFromFrame / widths.length,
        STATUS_PILL_MOTION.curveExponent
      )
    bottomItem.centerX = bottomItem.finalX + bottomItem.width / 2
    bottomItem.centerY = STATUS_PILL_HEIGHT / 2 + bottomIndex * STATUS_PILL_STEP
  }
  for (let index = bottomIndex - 1; index >= 0; index -= 1) {
    const item = layout[index]
    const lowerItem = layout[index + 1]
    if (!item || !lowerItem) continue
    const averageAngle = (item.angle + lowerItem.angle) / 2
    const normalX = Math.sin(averageAngle)
    const normalY = -Math.cos(averageAngle)
    const itemSupport = roundedRectangleSupport(
      item.width,
      STATUS_PILL_HEIGHT,
      STATUS_PILL_RADIUS,
      item.angle,
      normalX,
      normalY
    )
    const lowerItemSupport = roundedRectangleSupport(
      lowerItem.width,
      STATUS_PILL_HEIGHT,
      STATUS_PILL_RADIUS,
      lowerItem.angle,
      normalX,
      normalY
    )
    item.centerX =
      lowerItem.centerX +
      itemSupport.x +
      lowerItemSupport.x +
      normalX * STATUS_PILL_MOTION.gap
    item.finalX = item.centerX - item.width / 2
    item.centerY =
      lowerItem.centerY +
      itemSupport.y +
      lowerItemSupport.y +
      normalY * STATUS_PILL_MOTION.gap
  }
  for (let index = 0; index < layout.length; index += 1) {
    const item = layout[index]
    if (!item) continue
    const baseCenter = STATUS_PILL_HEIGHT / 2 + index * STATUS_PILL_STEP
    item.finalY = item.centerY - baseCenter
  }
  return layout
}

export const FRAME_STATUSES: ReadonlyArray<FrameStatusChrome> = [
  { id: "changes-requested", label: "Changes requested", ink: "oklch(52% 0.2 55)", shell: "oklch(95.25% 0.024 55)", stroke: "oklch(67% 0.18 55)", glyph: "statusChangesRequested" },
  { id: "in-progress", label: "In progress", ink: "oklch(52% 0.2 245.3)", shell: "oklch(95.25% 0.024 245.3)", stroke: "oklch(67% 0.18 245.3)", glyph: "statusInProgress" },
  { id: "archived", label: "Archived", ink: "oklch(28% 0 none)", shell: "oklch(95.25% 0 none)", stroke: "oklch(67% 0 none)", glyph: "statusArchived" },
  { id: "approved", label: "Approved", ink: "oklch(52% 0.2 156.3)", shell: "oklch(95.25% 0.024 156.3)", stroke: "oklch(67% 0.18 156.3)", glyph: "statusApproved" },
  { id: "ready-for-review", label: "Ready for review", ink: "oklch(52% 0.2 302)", shell: "oklch(95.25% 0.024 302)", stroke: "oklch(67% 0.18 302)", glyph: "statusReadyForReview" }
]

export const frameStatus = (status: FrameStatus): FrameStatusChrome =>
  FRAME_STATUSES.find((candidate) => candidate.id === status) ?? FRAME_STATUSES[1]!

export const shortIdForIndex = (index: number) => {
  let value = Math.max(0, index)
  let result = ""
  do {
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return result
}
