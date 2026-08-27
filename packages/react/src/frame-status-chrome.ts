import type { ReviewStatus } from "@crit/domain"

import type { GlyphName } from "./glyphs/index.js"

export interface FrameStatusChrome {
  readonly id: ReviewStatus
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
const STATUS_PILL_CHARACTER_WIDTH = 7

const STATUS_PILL_LABEL_WIDTHS = [
  { label: "Changes requested", width: 151 },
  { label: "In progress", width: 106 },
  { label: "Approved", width: 95 },
  { label: "Ready for review", width: 135 }
] as const

export const STATUS_PILL_MOTION = {
  spring: { type: "spring", visualDuration: 0.18, bounce: 0 },
  close: { duration: 0.2, ease: "easeOut" },
  curve: -55,
  curveExponent: 1.85,
  originOffset: 38,
  initialScale: 0.5,
  gap: 6
} as const

const STATUS_PILL_MOTION_TIMES = [0, 0.18, 0.36, 0.55, 0.75, 1]

export interface StatusPillMotionTarget {
  readonly startY: number
  readonly finalX: number
  readonly finalY: number
  readonly finalRotate: number
}

export function statusPillMotionPath({
  startY,
  finalX,
  finalY,
  finalRotate
}: StatusPillMotionTarget) {
  const x = STATUS_PILL_MOTION_TIMES.map((progress) =>
    progress === 0
      ? 0
      : finalX * Math.pow(progress, STATUS_PILL_MOTION.curveExponent)
  )
  const y = STATUS_PILL_MOTION_TIMES.map((progress) =>
    startY + (finalY - startY) * progress
  )
  const rotate = STATUS_PILL_MOTION_TIMES.map((progress) =>
    progress === 0 ? 0 : finalRotate * progress
  )
  return {
    enter: { x, y, rotate },
    exit: {
      x: [...x].reverse(),
      y: [...y].reverse(),
      rotate: [...rotate].reverse()
    },
    times: [...STATUS_PILL_MOTION_TIMES]
  }
}

export const measureStatusPillWidth = (label: string) =>
  STATUS_PILL_LABEL_WIDTHS.find((candidate) => candidate.label === label)?.width ??
    STATUS_PILL_CHROME_WIDTH + label.length * STATUS_PILL_CHARACTER_WIDTH

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

export const statusPillFrameGap = (
  bottomItem: Pick<StatusPillLayoutItem, "verticalHalfExtent"> | undefined
) => STATUS_PILL_MOTION.gap + Math.max(
  0,
  (bottomItem?.verticalHalfExtent ?? STATUS_PILL_HEIGHT / 2) -
    STATUS_PILL_HEIGHT / 2
)

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
  if (bottomItem !== undefined) {
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
    if (item === undefined || lowerItem === undefined) continue
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
    if (item === undefined) continue
    const baseCenter = STATUS_PILL_HEIGHT / 2 + index * STATUS_PILL_STEP
    item.finalY = item.centerY - baseCenter
  }
  return layout
}

export interface StatusFanLayoutItem<Option> extends StatusPillLayoutItem {
  readonly option: Option
  readonly startY: number
}

export interface StatusFanLayout<Option> {
  readonly frameGap: number
  readonly items: ReadonlyArray<StatusFanLayoutItem<Option>>
}

export function calculateStatusFanLayout<Option extends { readonly label: string }>(
  options: ReadonlyArray<Option>
): StatusFanLayout<Option> {
  const items = calculateStatusPillLayout(
    options.map((option) => measureStatusPillWidth(option.label))
  ).flatMap((item, index) => {
    const option = options[index]
    if (option === undefined) return []
    return [{
      ...item,
      option,
      startY:
        item.distanceFromFrame * STATUS_PILL_STEP +
        STATUS_PILL_MOTION.originOffset
    }]
  })

  return {
    frameGap: statusPillFrameGap(items.at(-1)),
    items
  }
}

export const reviewStatusLabel = {
  "in-progress": "In progress",
  "ready-for-review": "Ready for review",
  approved: "Approved",
  "changes-requested": "Changes requested"
} satisfies Record<ReviewStatus, string>

export const FRAME_STATUSES: ReadonlyArray<FrameStatusChrome> = [
  {
    id: "changes-requested",
    label: reviewStatusLabel["changes-requested"],
    ink: "oklch(52% 0.2 55)",
    shell: "oklch(95.25% 0.024 55)",
    stroke: "oklch(67% 0.18 55)",
    glyph: "statusChangesRequested"
  },
  {
    id: "in-progress",
    label: reviewStatusLabel["in-progress"],
    ink: "oklch(52% 0.2 245.3)",
    shell: "oklch(95.25% 0.024 245.3)",
    stroke: "oklch(67% 0.18 245.3)",
    glyph: "statusInProgress"
  },
  {
    id: "approved",
    label: reviewStatusLabel.approved,
    ink: "oklch(52% 0.2 156.3)",
    shell: "oklch(95.25% 0.024 156.3)",
    stroke: "oklch(67% 0.18 156.3)",
    glyph: "statusApproved"
  },
  {
    id: "ready-for-review",
    label: reviewStatusLabel["ready-for-review"],
    ink: "oklch(52% 0.2 302)",
    shell: "oklch(95.25% 0.024 302)",
    stroke: "oklch(67% 0.18 302)",
    glyph: "statusReadyForReview"
  }
]

export const frameStatus = (status: ReviewStatus): FrameStatusChrome => {
  const found = FRAME_STATUSES.find((candidate) => candidate.id === status)
  if (found !== undefined) return found
  const fallback = FRAME_STATUSES[1]
  if (fallback === undefined) throw new Error("Missing frame statuses")
  return fallback
}

export const frameStatusChrome = {
  "changes-requested": frameStatus("changes-requested"),
  "in-progress": frameStatus("in-progress"),
  approved: frameStatus("approved"),
  "ready-for-review": frameStatus("ready-for-review")
} satisfies Record<ReviewStatus, FrameStatusChrome>

export const frameStatusMenuOptions = (current: ReviewStatus) =>
  FRAME_STATUSES.filter((status) => status.id !== current)

export const shortIdForIndex = (index: number) => {
  let value = Math.max(0, index)
  let result = ""
  do {
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return result
}

export const statusFanProjection = (
  screenFrameGap: number,
  uiScale = 1
) => ({
  scale: uiScale,
  frameGap: screenFrameGap * uiScale
})

export const statusMenuFrameZIndex = (
  frameZIndex: number,
  topCanvasZIndex: number,
  active: boolean
) => active ? Math.max(frameZIndex, topCanvasZIndex) : frameZIndex
