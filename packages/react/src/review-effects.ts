import { Match } from "effect"
import {
  useCallback,
  useMemo,
  useState,
  type RefObject
} from "react"

import { ReviewClientEffect } from "./review-actions.js"

export interface ReviewEffectContext {
  readonly frameElement: HTMLElement | null
  readonly setFullscreenFrameId?: ((frameId: string | null) => void) | undefined
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
    openFrame: () => {
      const url = context.frameElement?.querySelector("iframe")?.src
      if (url === undefined || url === "" || url === "about:blank") return
      window.open(url, "_blank", "noopener,noreferrer")
    },
    reloadFrame: () => {
      const iframe = context.frameElement?.querySelector("iframe")
      if (iframe === null || iframe === undefined) return
      const source = iframe.src
      try {
        const location = iframe.contentWindow?.location
        if (location !== undefined && location.href !== "about:blank") {
          location.reload()
          return
        }
      } catch {
        iframe.src = source
        return
      }
      iframe.src = source
    },
    fullscreen: ({ target }) => {
      context.setFullscreenFrameId?.(
        target === "exit" ? null : context.frameElement?.dataset.frameId ?? null
      )
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
  const [fullscreenFrameId, setFullscreenFrameId] = useState<string | null>(null)

  const onEffect = args.onEffect
  const selectedFrameRef = args.selectedFrameRef
  const zoomToFit = args.zoomToFit
  const handle = useCallback((effect: ReviewClientEffect) => {
    if (ReviewClientEffect.$is("fullscreen")(effect) || ReviewClientEffect.$is("reloadFrame")(effect) || ReviewClientEffect.$is("openFrame")(effect)) {
      applyReviewEffect(effect, {
        frameElement: selectedFrameRef.current,
        setFullscreenFrameId
      })
      onEffect?.(effect)
      return
    }
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
    fullscreen: fullscreenFrameId !== null,
    fullscreenFrameId,
    handle
  }), [fullscreenFrameId, handle])
}
