import type { Frame } from "@crit/domain"
import { Match } from "effect"
import {
  useEffect,
  useState,
  type RefObject
} from "react"

import type { ReviewClientEffect } from "./review-actions.js"

export interface ReviewEffectContext {
  readonly frameElement: HTMLElement | null
  readonly zoomToFit?: () => void
}

export const applyReviewEffect = (
  effect: ReviewClientEffect,
  context: ReviewEffectContext
): void => {
  Match.value(effect).pipe(Match.tagsExhaustive({
    openUrl: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer")
    },
    fullscreen: ({ target }) => {
      if (target === "exit") {
        void document.exitFullscreen()
        return
      }
      if (context.frameElement !== null) {
        void context.frameElement.requestFullscreen()
      }
    },
    copy: ({ text }) => {
      void navigator.clipboard?.writeText(text)
    },
    zoomToFit: () => {
      context.zoomToFit?.()
    }
  }))
}

export const useReviewEffects = (args: {
  readonly frameElementsRef: RefObject<Map<string, HTMLDivElement>>
  readonly frames: readonly Frame[]
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly selectedFrameRef: RefObject<HTMLDivElement | null>
  readonly zoomToFit?: () => void
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
      frameElement: args.selectedFrameRef.current,
      ...(args.zoomToFit === undefined ? {} : { zoomToFit: args.zoomToFit })
    })
  }

  return {
    fullscreen,
    handle,
    isFramePaused: (frameId: string) => offscreenFrames.has(frameId)
  }
}
