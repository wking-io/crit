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

  it("opens the resolved application URL synchronously", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const frameElement = document.createElement("div")
    const iframe = document.createElement("iframe")
    iframe.src = "http://localhost:3000/agent-design-preview?sidebar=unified"
    frameElement.append(iframe)
    applyReviewEffect({ _tag: "openFrame" }, { frameElement })
    expect(open).toHaveBeenCalledExactlyOnceWith(
      iframe.src, "_blank", "noopener,noreferrer"
    )
    applyReviewEffect({ _tag: "openFrame" }, { frameElement: null })
    applyReviewEffect({ _tag: "openFrame" }, { frameElement: document.createElement("div") })
    expect(open).toHaveBeenCalledTimes(1)
  })

  it("reloads the current same-origin iframe page", () => {
    const frameElement = document.createElement("div")
    const iframe = document.createElement("iframe")
    frameElement.append(iframe)
    const reload = vi.fn()
    Object.defineProperty(iframe, "contentWindow", {
      value: { location: { href: "https://example.com/current", reload } }
    })
    applyReviewEffect({ _tag: "reloadFrame" }, { frameElement })
    expect(reload).toHaveBeenCalledOnce()
  })

  it("reloads cross-origin frames through their source without replacing the element", () => {
    const frameElement = document.createElement("div")
    const iframe = document.createElement("iframe")
    iframe.src = "https://example.com/page"
    frameElement.append(iframe)
    Object.defineProperty(iframe, "contentWindow", {
      get() { throw new DOMException("Cross origin", "SecurityError") }
    })
    const setSrc = vi.spyOn(iframe, "src", "set")
    applyReviewEffect({ _tag: "reloadFrame" }, { frameElement })
    expect(setSrc).toHaveBeenCalledWith("https://example.com/page")
    expect(frameElement.querySelector("iframe")).toBe(iframe)
    expect(() => applyReviewEffect({ _tag: "reloadFrame" }, { frameElement: null })).not.toThrow()
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
    const setFullscreenFrameId = vi.fn()
    const frameElement = document.createElement("div")
    frameElement.dataset.frameId = "frame_a"

    applyReviewEffect(
      { _tag: "fullscreen", target: "frame" },
      { frameElement, setFullscreenFrameId }
    )
    applyReviewEffect(
      { _tag: "fullscreen", target: "exit" },
      { frameElement, setFullscreenFrameId }
    )

    expect(setFullscreenFrameId).toHaveBeenNthCalledWith(1, "frame_a")
    expect(setFullscreenFrameId).toHaveBeenNthCalledWith(2, null)
  })

  it("fits the camera when a zoom handler is provided", () => {
    const zoomToFit = vi.fn()
    applyReviewEffect({ _tag: "zoomToFit" }, { frameElement: null, zoomToFit })
    expect(zoomToFit).toHaveBeenCalledOnce()
  })

})
