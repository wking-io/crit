import { Match } from "effect"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject
} from "react"

import type { ReviewClientEffect } from "./review-actions.js"

export interface ReviewEffectContext {
  readonly frameElement: HTMLElement | null
  readonly zoomToFit?: (() => void) | undefined
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
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly selectedFrameRef: RefObject<HTMLDivElement | null>
  readonly zoomToFit?: () => void
}) => {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement !== null)
    changed()
    document.addEventListener("fullscreenchange", changed)
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [])

  const onEffect = args.onEffect
  const selectedFrameRef = args.selectedFrameRef
  const zoomToFit = args.zoomToFit
  const handle = useCallback((effect: ReviewClientEffect) => {
    if (onEffect !== undefined) {
      onEffect(effect)
      return
    }
    applyReviewEffect(effect, {
      frameElement: selectedFrameRef.current,
      zoomToFit
    })
  }, [onEffect, selectedFrameRef, zoomToFit])

  return useMemo(() => ({
    fullscreen,
    handle
  }), [fullscreen, handle])
}
