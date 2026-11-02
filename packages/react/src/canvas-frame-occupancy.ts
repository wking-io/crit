import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react"

import type { CanvasCamera } from "./canvas-camera.js"
import { frameMountQueueFor } from "./frame-mount-queue.js"

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
  const [intersecting, setIntersecting] = useState(false)
  const [mounted, setMounted] = useState(false)

  const priorityRef = useRef(Infinity)

  useEffect(() => {
    const element = elementRef.current
    if (element === null) return
    const root = element.closest(".crit-canvas") ?? element
    return frameMountQueueFor(root).enqueue((ready) => {
      const loaded = (event: Event) => {
        if (event.target instanceof HTMLIFrameElement) ready()
      }
      element.addEventListener("load", loaded, true)
      setMounted(true)
      return () => element.removeEventListener("load", loaded, true)
    }, () => priorityRef.current)
  }, [elementRef])

  useLayoutEffect(() => {
    const element = elementRef.current
    if (element === null) return
    const root = element.closest(".crit-canvas")
    const elementRect = element.getBoundingClientRect()
    const rootRect = root instanceof Element
      ? root.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const update = (rect: Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">, visible: boolean) => {
      priorityRef.current = visible ? 0 : 1 + Math.hypot(
        (rect.left + rect.right - rootRect.left - rootRect.right) / 2,
        (rect.top + rect.bottom - rootRect.top - rootRect.bottom) / 2
      )
      setIntersecting(visible)
      frameMountQueueFor(root ?? element).wake()
    }
    update(elementRect,
      elementRect.right >= rootRect.left - FRAME_IFRAME_MOUNT_MARGIN &&
      elementRect.bottom >= rootRect.top - FRAME_IFRAME_MOUNT_MARGIN &&
      elementRect.left <= rootRect.right + FRAME_IFRAME_MOUNT_MARGIN &&
      elementRect.top <= rootRect.bottom + FRAME_IFRAME_MOUNT_MARGIN
    )
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      update(entry.boundingClientRect ?? element.getBoundingClientRect(), entry.isIntersecting)
    }, {
      root: root instanceof Element ? root : null,
      rootMargin: `${FRAME_IFRAME_MOUNT_MARGIN}px`
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef])

  return { mounted, painted: mounted && intersecting }
}
