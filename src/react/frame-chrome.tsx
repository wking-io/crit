import type { ReactNode, SVGProps } from "react"

import type { FrameStatus } from "../core/index.js"

export interface FrameStatusChrome {
  readonly id: FrameStatus
  readonly label: string
  readonly ink: string
  readonly shell: string
  readonly stroke: string
  readonly icon: (props: SVGProps<SVGSVGElement>) => ReactNode
}

const ICON_OPACITY = 0.2
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

const IconFlag = (props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <path d="M3.75 3.24C4.911 2.432 6.006 2.098 7.031 2.256C8.721 2.515 9.276 3.965 10.969 4.225C11.982 4.38 13.075 4.058 14.25 3.241V9.804C13.075 10.622 11.982 10.944 10.969 10.788C9.277 10.528 8.721 9.078 7.031 8.819C6.005 8.662 4.911 8.996 3.75 9.803" fill="currentColor" fillOpacity={ICON_OPACITY} />
    <path d="M3.75 3.24C4.911 2.432 6.006 2.098 7.031 2.256C8.721 2.515 9.276 3.965 10.969 4.225C11.982 4.38 13.075 4.058 14.25 3.241V9.804C13.075 10.622 11.982 10.944 10.969 10.788C9.277 10.528 8.721 9.078 7.031 8.819C6.005 8.662 4.911 8.996 3.75 9.803M3.75 2V16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconCheck = (props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <path d="M13.25 2.75H4.75C3.645 2.75 2.75 3.645 2.75 4.75V13.25C2.75 14.355 3.645 15.25 4.75 15.25H13.25C14.355 15.25 15.25 14.355 15.25 13.25V4.75C15.25 3.645 14.355 2.75 13.25 2.75Z" fill="currentColor" fillOpacity={ICON_OPACITY} />
    <path d="M5.5 9C6.363 9.867 7.037 10.868 7.6 11.962C8.907 9.471 10.54 7.496 12.5 6.039M13.25 2.75H4.75C3.645 2.75 2.75 3.645 2.75 4.75V13.25C2.75 14.355 3.645 15.25 4.75 15.25H13.25C14.355 15.25 15.25 14.355 15.25 13.25V4.75C15.25 3.645 14.355 2.75 13.25 2.75Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconAtom = (props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <circle cx="9" cy="9" r="2.25" fill="currentColor" fillOpacity={ICON_OPACITY} stroke="currentColor" />
    <path d="M13.163 3.07C12.309 2.469 11.32 2.051 10.25 1.865M16.137 7.75C15.958 6.721 15.554 5.727 14.929 4.838M14.93 13.163C15.531 12.309 15.949 11.32 16.135 10.25M10.25 16.137C11.279 15.958 12.273 15.554 13.162 14.929M4.837 14.93C5.691 15.531 6.68 15.949 7.75 16.135M1.863 10.25C2.042 11.279 2.446 12.273 3.071 13.162M3.07 4.837C2.469 5.691 2.051 6.68 1.865 7.75M7.75 1.863C6.721 2.042 5.727 2.446 4.838 3.071" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconEye = (props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="M9 3.5C12.787 3.5 15.001 6.205 15.951 7.878C16.343 8.571 16.348 9.42 15.956 10.113C15.006 11.786 12.787 14.5 9 14.5C5.206 14.5 2.992 11.785 2.045 10.113C1.652 9.42 1.652 8.579 2.045 7.887C2.992 6.215 5.206 3.5 9 3.5ZM9 6.25C7.481 6.25 6.25 7.481 6.25 9C6.25 10.519 7.481 11.75 9 11.75C10.518 11.75 11.75 10.519 11.75 9C11.75 7.481 10.518 6.25 9 6.25Z" fill="currentColor" fillOpacity={ICON_OPACITY} />
    <path d="M9 11.75C10.519 11.75 11.75 10.519 11.75 9C11.75 7.481 10.519 6.25 9 6.25C7.481 6.25 6.25 7.481 6.25 9C6.25 10.519 7.481 11.75 9 11.75ZM10.922 10.966L14.25 14.25M15.321 11.092C15.574 10.747 15.786 10.413 15.956 10.113C16.348 9.42 16.348 8.579 15.956 7.887C15.009 6.215 12.794 3.5 9 3.5C5.206 3.5 2.991 6.215 2.044 7.887C1.652 8.579 1.652 9.42 2.044 10.113C2.991 11.785 5.206 14.5 9 14.5C9.399 14.5 9.776 14.464 10.14 14.408" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconTray = (props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}>
    <path d="M2.75 5.25H15.25V13.75C15.25 14.854 14.354 15.75 13.25 15.75H4.75C3.646 15.75 2.75 14.854 2.75 13.75V5.25Z" fill="currentColor" fillOpacity={ICON_OPACITY} />
    <path d="M2.75 5.25L5 2.25H13L15.25 5.25M11.25 10.5L9 12.75L6.75 10.5M9 12.75V8.25M2.75 5.25H15.25V13.75C15.25 14.854 14.354 15.75 13.25 15.75H4.75C3.646 15.75 2.75 14.854 2.75 13.75V5.25ZM9 2.25V5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const FRAME_STATUSES: ReadonlyArray<FrameStatusChrome> = [
  { id: "changes-requested", label: "Changes requested", ink: "oklch(64.6% 0.222 41.1)", shell: "oklch(75% 0.183 55.9 / 30%)", stroke: "oklch(64.6% 0.222 41.1 / 30%)", icon: IconFlag },
  { id: "in-progress", label: "In progress", ink: "oklch(54.6% 0.245 262.9)", shell: "oklch(80.9% 0.105 251.8 / 30%)", stroke: "oklch(54.6% 0.245 262.9 / 30%)", icon: IconAtom },
  { id: "archived", label: "Archived", ink: "oklch(26.9% 0 0)", shell: "oklch(87% 0 0 / 30%)", stroke: "oklch(26.9% 0 0 / 30%)", icon: IconTray },
  { id: "approved", label: "Approved", ink: "oklch(62.7% 0.194 149.2)", shell: "oklch(79.2% 0.209 151.7 / 30%)", stroke: "oklch(62.7% 0.194 149.2 / 30%)", icon: IconCheck },
  { id: "ready-for-review", label: "Ready for review", ink: "oklch(50% 0.24 302)", shell: "oklch(78% 0.16 302 / 30%)", stroke: "oklch(50% 0.24 302 / 30%)", icon: IconEye }
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

export function IconSnapshot(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M13.25 4.25H11.6L10.85 3H7.15L6.4 4.25H4.75C3.645 4.25 2.75 5.145 2.75 6.25V13.25C2.75 14.355 3.645 15.25 4.75 15.25H13.25C14.355 15.25 15.25 14.355 15.25 13.25V6.25C15.25 5.145 14.355 4.25 13.25 4.25Z" fill="currentColor" fillOpacity={ICON_OPACITY} /><path d="M13.25 4.25H11.6L10.85 3H7.15L6.4 4.25H4.75C3.645 4.25 2.75 5.145 2.75 6.25V13.25C2.75 14.355 3.645 15.25 4.75 15.25H13.25C14.355 15.25 15.25 14.355 15.25 13.25V6.25C15.25 5.145 14.355 4.25 13.25 4.25Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="9.75" r="2.5" fill="none" stroke="currentColor" /></svg>
}

export function IconOpenExternal(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="m7.75 15.25h5.5c1.105 0 2-.895 2-2v-8.5c0-1.105-.895-2-2-2h-8.5c-1.105 0-2 .895-2 2v5.5h4c.552 0 1 .448 1 1v4Z" fill="currentColor" fillOpacity={ICON_OPACITY} /><rect x="2.75" y="2.75" width="12.5" height="12.5" rx="2" fill="none" stroke="currentColor" /><path d="M12.25 9V5.75H9M12.25 5.75l-3 3M2.75 11.25c0-.552.448-1 1-1h3c.552 0 1 .448 1 1v3c0 .552-.448 1-1 1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function IconFullscreen(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><rect x="3" y="3" width="12" height="12" rx="2" fill="currentColor" fillOpacity={ICON_OPACITY} /><path d="M2.75 15.25 15.25 2.75M10.75 2.75h4.5v4.5M2.75 10.75v4.5h4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function IconMinimize(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><rect x="3" y="3" width="12" height="12" rx="2" fill="currentColor" fillOpacity={ICON_OPACITY} /><path d="M15.25 7.25H10.75V2.75M7.25 15.25V10.75H2.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="m13.145 5.043-.456 8.938c-.05.997-.84 1.769-1.797 1.769H7.107c-.957 0-1.747-.772-1.797-1.769l-.455-8.938" fill="currentColor" fillOpacity={ICON_OPACITY} /><path d="M3.375 5.043h11.25M6.975 5.043V3.181c0-.512.403-.931.9-.931h2.25c.497 0 .9.419.9.931v1.862M13.37 5.043l-.455 8.938c-.05.997-.841 1.769-1.797 1.769H6.883c-.957 0-1.747-.772-1.797-1.769L4.63 5.043" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export const IconUndo = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M2.25 6.25H12C14.071 6.25 15.75 7.929 15.75 10C15.75 12.071 14.071 13.75 12 13.75H8.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /><path d="M5.75 9.75 2.25 6.25 5.75 2.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const IconRedo = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M15.75 6.25H6C3.929 6.25 2.25 7.929 2.25 10C2.25 12.071 3.929 13.75 6 13.75H9.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /><path d="M12.25 9.75 15.75 6.25 12.25 2.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const IconPointer = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M2.07 3.463 6.451 15.293C6.802 16.241 8.145 16.235 8.487 15.284L10.113 10.767C10.222 10.463 10.462 10.224 10.766 10.114L15.283 8.488C16.234 8.146 16.24 6.803 15.292 6.452L3.463 2.07C2.594 1.748 1.749 2.594 2.07 3.463Z" fill="currentColor" fillOpacity=".3" /><path d="M2.07 3.463 6.451 15.293C6.802 16.241 8.145 16.235 8.487 15.284L10.113 10.767C10.222 10.463 10.462 10.224 10.766 10.114L15.283 8.488C16.234 8.146 16.24 6.803 15.292 6.452L3.463 2.07C2.594 1.748 1.749 2.594 2.07 3.463Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const IconPan = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path fillRule="evenodd" clipRule="evenodd" d="M8.02213 2.61394C8.02213 1.86066 8.63278 1.25 9.38606 1.25C10.1393 1.25 10.75 1.86066 10.75 2.61394V3.87068C10.75 3.11367 11.3637 2.5 12.1207 2.5C12.8777 2.5 13.4914 3.11368 13.4914 3.87068V4.51473C13.7195 4.20282 14.0882 4 14.501 4C15.187 4 15.751 4.56 15.751 5.25V11.251C15.751 14.012 13.512 16.251 10.751 16.251H9.00599C6.97599 16.251 5.08299 15.224 3.97599 13.521L2.01599 10.507C1.62299 9.883 1.68699 9.176 2.22699 8.752C2.76699 8.328 3.55599 8.42 3.98199 8.963L5.74999 11.215V3.75C5.74999 3.06 6.31399 2.5 6.99999 2.5C7.42046 2.5 7.7951 2.71039 8.02213 3.03214V2.61394Z" fill="currentColor" fillOpacity=".3" /><path d="M10.75 7.75V2.5C10.75 1.81 10.186 1.25 9.5 1.25C8.814 1.25 8.25 1.81 8.25 2.5V7.75" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M13.25 7.75V3.75C13.25 3.06 12.686 2.5 12 2.5C11.314 2.5 10.75 3.06 10.75 3.75V7.75" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M8.24999 7.75V3.75C8.24999 3.06 7.68599 2.5 6.99999 2.5C6.31399 2.5 5.74999 3.06 5.74999 3.75V11.215L3.98199 8.963C3.55599 8.42 2.76699 8.328 2.22699 8.752C1.68699 9.176 1.62299 9.883 2.01599 10.507L3.97599 13.521C5.08299 15.224 6.97599 16.251 9.00599 16.251H10.751C13.512 16.251 15.751 14.012 15.751 11.251V5.25C15.751 4.56 15.187 4 14.501 4C13.815 4 13.251 4.56 13.251 5.25V7.75" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
export const IconAddFrame = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M1.75 4.75C1.75 3.65 2.645 2.75 3.75 2.75H14.25C15.355 2.75 16.25 3.65 16.25 4.75V7.75H1.75V4.75Z" fill="currentColor" opacity=".3" /><path d="M4.25 6C4.664 6 5 5.66 5 5.25C5 4.84 4.664 4.5 4.25 4.5C3.836 4.5 3.5 4.84 3.5 5.25C3.5 5.66 3.836 6 4.25 6ZM6.75 6C7.164 6 7.5 5.66 7.5 5.25C7.5 4.84 7.164 4.5 6.75 4.5C6.336 4.5 6 4.84 6 5.25C6 5.66 6.336 6 6.75 6Z" fill="currentColor" /><path d="M1.75 7.75H16.25M14.25 12.25V17.25M16.75 14.75H11.75M16.25 10.014V4.75C16.25 3.65 15.355 2.75 14.25 2.75H3.75C2.645 2.75 1.75 3.65 1.75 4.75V13.25C1.75 14.35 2.645 15.25 3.75 15.25H8.792" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const IconNote = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M10.25 11.25C10.25 10.698 10.698 10.25 11.25 10.25H15.217C15.235 10.142 15.25 10.033 15.249 9.922V4.75C15.249 3.645 14.354 2.75 13.249 2.75H4.75C3.645 2.75 2.75 3.645 2.75 4.75V13.25C2.75 14.355 3.645 15.25 4.75 15.25H9.922C10.033 15.25 10.142 15.106 10.25 15.217V11.25Z" fill="currentColor" opacity=".3" /><path d="M7.25 11.75H5.75M8 9H5.75M12.25 6.25H5.75M4.75 2.75H13.25C14.355 2.75 15.25 3.645 15.25 4.75V9.922C15.25 10.452 15.039 10.961 14.664 11.336L11.336 14.664C10.961 15.039 10.452 15.25 9.922 15.25H4.75C3.645 15.25 2.75 14.355 2.75 13.25V4.75C2.75 3.645 3.645 2.75 4.75 2.75ZM10.25 15.148V11.25C10.25 10.698 10.698 10.25 11.25 10.25H15.16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const IconComment = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M9 1.75C4.996 1.75 1.75 4.996 1.75 9C1.75 10.319 2.108 11.552 2.723 12.617C3.153 13.423 2.67 15.329 1.75 16.25C3 16.318 4.647 15.753 5.383 15.277C5.872 15.559 6.647 15.933 7.662 16.125C8.095 16.207 8.543 16.25 9 16.25C13.004 16.25 16.25 13.004 16.25 9C16.25 4.996 13.004 1.75 9 1.75Z" fill="currentColor" fillOpacity=".3" /><path d="M9 1.75C4.996 1.75 1.75 4.996 1.75 9C1.75 10.319 2.108 11.552 2.723 12.617C3.153 13.423 2.67 15.329 1.75 16.25C3 16.318 4.647 15.753 5.383 15.277C5.872 15.559 6.647 15.933 7.662 16.125C8.095 16.207 8.543 16.25 9 16.25C13.004 16.25 16.25 13.004 16.25 9C16.25 4.996 13.004 1.75 9 1.75Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
export const IconCommentPin = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path fillRule="evenodd" clipRule="evenodd" d="M9 1.75C12.3137 1.75 15 4.438 15 7.75C15 12.25 10.5833 15.75 9 16.25C7.4167 15.75 3 12.25 3 7.75C3 4.438 5.6863 1.75 9 1.75ZM9 5.75C7.8954 5.75 7 6.646 7 7.75C7 8.854 7.8954 9.75 9 9.75C10.1046 9.75 11 8.854 11 7.75C11 6.646 10.1046 5.75 9 5.75Z" fill="currentColor" fillOpacity=".3" /><path d="M9 9.75C10.1046 9.75 11 8.854 11 7.75C11 6.646 10.1046 5.75 9 5.75C7.8954 5.75 7 6.646 7 7.75C7 8.854 7.8954 9.75 9 9.75Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M9 16.25C10.5833 15.75 15 12.25 15 7.75C15 4.438 12.3137 1.75 9 1.75C5.6863 1.75 3 4.438 3 7.75C3 12.25 7.4167 15.75 9 16.25Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
export const IconLayers = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="m3 6 6-3 6 3-6 3-6-3Z" fill="currentColor" fillOpacity={ICON_OPACITY} /><path d="m3 6 6-3 6 3-6 3-6-3Zm0 3 6 3 6-3m-12 3 6 3 6-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const IconSwitcher = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="M12.5 6.25 9 2.75l-3.5 3.5M12.5 11.75 9 15.25l-3.5-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>

export const IconEditTitle = (props: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" {...props}><path d="m15.183 2.743c-7.005.475-10.498 6.036-11.369 8.757.685.512 2.766 1.407 5.609.893 2.843-.514 3.552-2.645 3.551-3.646 2.154-1.324 1.111-3.371 2.209-6.004Z" fill="currentColor" opacity=".3" /><path d="M2.75 15.25S4.062 3.729 15.25 2.75c-.56.976-.573 2.605-.946 4.239-.524 2.011-2.335 2.261-4.554 2.261M12.974 8.731c-.453 3.525-3.437 4.068-6.536 3.593" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
