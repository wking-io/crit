import {
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react"

import type { CanvasCamera } from "./canvas-camera.js"

export const FRAME_IFRAME_MOUNT_MARGIN = 500

export type FrameIframeOccupancy = {
  readonly mounted: boolean
  readonly painted: boolean
}

export const frameIntersectsViewport = (
  geometry: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  camera: CanvasCamera,
  width: number,
  height: number,
  margin = FRAME_IFRAME_MOUNT_MARGIN
): boolean => {
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

export const useFrameOccupancy = (
  elementRef: RefObject<Element | null>
): FrameIframeOccupancy => {
  const [intersecting, setIntersecting] = useState(true)
  const mountedRef = useRef(false)
  if (intersecting) mountedRef.current = true

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element === null) return
    const root = element.closest(".crit-canvas")
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      setIntersecting(entry.isIntersecting)
    }, {
      root: root instanceof Element ? root : null,
      rootMargin: `${FRAME_IFRAME_MOUNT_MARGIN}px`
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef])

  return frameIframeOccupancy(intersecting, mountedRef.current)
}
