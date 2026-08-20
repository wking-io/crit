import type { CanvasGeometry } from "../core/index.js"
import type { CanvasCamera } from "./canvas-camera.js"

export const FRAME_IFRAME_MOUNT_MARGIN = 500

export type FrameIframeOccupancy = {
  readonly mounted: boolean
  readonly painted: boolean
}

export const frameIntersectsViewport = (
  geometry: CanvasGeometry,
  camera: CanvasCamera,
  width: number,
  height: number,
  margin = FRAME_IFRAME_MOUNT_MARGIN
) => {
  const left = geometry.x * camera.zoom + camera.x
  const top = geometry.y * camera.zoom + camera.y
  const right = left + geometry.width * camera.zoom
  const bottom = top + geometry.height * camera.zoom
  return (
    right >= -margin &&
    bottom >= -margin &&
    left <= width + margin &&
    top <= height + margin
  )
}

export const DEFAULT_PAUSE_OFFSCREEN_FRAMES = true

const PAUSE_OFFSCREEN_FRAMES_KEY = "@riff-refine/crit/pause-offscreen-frames"

export type FrameOccupancyStorage = {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

export const frameIframeOccupancy = (
  intersecting: boolean,
  previouslyMounted: boolean,
  pauseOffscreen = DEFAULT_PAUSE_OFFSCREEN_FRAMES
): FrameIframeOccupancy => {
  const mounted = intersecting || previouslyMounted
  return {
    mounted,
    painted: pauseOffscreen ? intersecting : mounted
  }
}

export const readPauseOffscreenFrames = (
  storage: FrameOccupancyStorage | null
) => {
  if (storage === null) return DEFAULT_PAUSE_OFFSCREEN_FRAMES
  try {
    const value = storage.getItem(PAUSE_OFFSCREEN_FRAMES_KEY)
    if (value === "false") return false
    if (value === "true") return true
    return DEFAULT_PAUSE_OFFSCREEN_FRAMES
  } catch {
    return DEFAULT_PAUSE_OFFSCREEN_FRAMES
  }
}

export const writePauseOffscreenFrames = (
  storage: FrameOccupancyStorage | null,
  pause: boolean
) => {
  if (storage === null) return false
  try {
    storage.setItem(PAUSE_OFFSCREEN_FRAMES_KEY, pause ? "true" : "false")
    return true
  } catch {
    return false
  }
}
