import { afterEach, describe, expect, it, vi } from "vitest"

import { applyReviewEffect } from "../src/review-effects.js"

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "clipboard"
)
const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "exitFullscreen"
)

afterEach(() => {
  vi.restoreAllMocks()
  if (clipboardDescriptor === undefined) {
    Reflect.deleteProperty(Navigator.prototype, "clipboard")
  } else {
    Object.defineProperty(
      Navigator.prototype,
      "clipboard",
      clipboardDescriptor
    )
  }
  if (exitFullscreenDescriptor === undefined) {
    Reflect.deleteProperty(Document.prototype, "exitFullscreen")
  } else {
    Object.defineProperty(
      Document.prototype,
      "exitFullscreen",
      exitFullscreenDescriptor
    )
  }
})

describe("applyReviewEffect", () => {
  it("opens web URLs", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    applyReviewEffect(
      { _tag: "openUrl", url: "https://example.com" },
      { frameElement: null }
    )

    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer"
    )
  })

  it("copies node ids", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      value: { writeText }
    })

    applyReviewEffect(
      { _tag: "copy", text: "note_a" },
      { frameElement: null }
    )

    expect(writeText).toHaveBeenCalledWith("note_a")
  })

  it("enters and exits fullscreen", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    const frameElement = document.createElement("div")
    Object.defineProperty(frameElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen
    })
    Object.defineProperty(Document.prototype, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen
    })

    applyReviewEffect(
      { _tag: "fullscreen", target: "frame" },
      { frameElement }
    )
    applyReviewEffect(
      { _tag: "fullscreen", target: "exit" },
      { frameElement }
    )

    expect(requestFullscreen).toHaveBeenCalledOnce()
    expect(exitFullscreen).toHaveBeenCalledOnce()
  })

  it("fits the camera when a zoom handler is provided", () => {
    const zoomToFit = vi.fn()
    applyReviewEffect({ _tag: "zoomToFit" }, { frameElement: null, zoomToFit })
    expect(zoomToFit).toHaveBeenCalledOnce()
  })

})
