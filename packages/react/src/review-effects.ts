import type { ReviewClientEffect } from "./review-actions.js"

export interface ReviewEffectContext {
  readonly frameElement: HTMLElement | null
  readonly setPauseOffscreen: (value: boolean) => void
}

export const applyReviewEffect = (
  effect: ReviewClientEffect,
  context: ReviewEffectContext
): void => {
  switch (effect._tag) {
    case "open-url":
      window.open(effect.url)
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
      return
    case "set-preference":
      context.setPauseOffscreen(effect.value)
  }
}
