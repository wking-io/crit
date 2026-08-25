import type { Frame } from "@crit/domain"
import {
  useEffect,
  useState,
  type RefObject
} from "react"

import type { ReviewClientEffect } from "./review-actions.js"

export interface ReviewEffectContext {
  readonly frameElement: HTMLElement | null
}

export const applyReviewEffect = (
  effect: ReviewClientEffect,
  context: ReviewEffectContext
): void => {
  switch (effect._tag) {
    case "openUrl":
      window.open(effect.url, "_blank", "noopener,noreferrer")
      return
    case "fullscreen":
      if (effect.target === "exit") {
        void document.exitFullscreen()
        return
      }
      if (context.frameElement !== null) {
        void context.frameElement.requestFullscreen()
      }
      return
    case "copy":
      void navigator.clipboard?.writeText(effect.text)
  }
}

export const useReviewEffects = (args: {
  readonly frameElementsRef: RefObject<Map<string, HTMLDivElement>>
  readonly frames: readonly Frame[]
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly selectedFrameRef: RefObject<HTMLDivElement | null>
}) => {
  const [fullscreen, setFullscreen] = useState(false)
  const [offscreenFrames, setOffscreenFrames] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null)
    changed()
    document.addEventListener("fullscreenchange", changed)
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      setOffscreenFrames((current) => {
        const next = new Set(current)
        for (const entry of entries) {
          const frameId = entry.target.getAttribute("data-frame-id")
          if (frameId === null) continue
          if (entry.isIntersecting) next.delete(frameId)
          else next.add(frameId)
        }
        return next
      })
    })
    for (const element of args.frameElementsRef.current.values()) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [args.frameElementsRef, args.frames])

  const handle = (effect: ReviewClientEffect) => {
    if (args.onEffect !== undefined) {
      args.onEffect(effect)
      return
    }
    applyReviewEffect(effect, {
      frameElement: args.selectedFrameRef.current
    })
  }

  return {
    fullscreen,
    handle,
    isFramePaused: (frameId: string) => offscreenFrames.has(frameId)
  }
}
