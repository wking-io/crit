import { Id } from "@crit/domain"
import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { newFrameCommand, nextFrameGeometry } from "../src/new-frame.js"

describe("newFrameCommand", () => {
  it("infers checkout from an empty title", () => {
    const frameId = Id.frame("frame_checkout")
    const geometry = { x: 40, y: 80, width: 320, height: 200 }
    expect(newFrameCommand({
      url: "https://example.com/checkout",
      title: "",
      frameId,
      geometry
    })).toEqual(Result.succeed({
      _tag: "add-frame",
      frameId,
      title: "checkout",
      representation: { _tag: "web-url", url: "https://example.com/checkout" },
      status: "in-progress",
      geometry
    }))
  })

  it("keeps an explicit title", () => {
    const frameId = Id.frame("frame_named")
    const geometry = { x: 10, y: 20, width: 1200, height: 800 }
    expect(newFrameCommand({
      url: "https://example.com/checkout",
      title: "Checkout flow",
      frameId,
      geometry
    })).toEqual(Result.succeed({
      _tag: "add-frame",
      frameId,
      title: "Checkout flow",
      representation: { _tag: "web-url", url: "https://example.com/checkout" },
      status: "in-progress",
      geometry
    }))
  })

  it("lowercases the host and succeeds", () => {
    const frameId = Id.frame("frame_mixed_host")
    const geometry = { x: 0, y: 0, width: 1200, height: 800 }
    expect(newFrameCommand({
      url: "https://Example.com/path",
      title: "Path",
      frameId,
      geometry
    })).toEqual(Result.succeed({
      _tag: "add-frame",
      frameId,
      title: "Path",
      representation: { _tag: "web-url", url: "https://example.com/path" },
      status: "in-progress",
      geometry
    }))
  })

  it("rejects localhost and does not produce a command", () => {
    expect(newFrameCommand({
      url: "http://localhost:3000",
      title: "Local",
      frameId: Id.frame("frame_local"),
      geometry: { x: 0, y: 0, width: 1200, height: 800 }
    })).toEqual(Result.fail({ reason: "A frame URL cannot use localhost." }))
  })

  it("rejects a string that is not a URL", () => {
    expect(newFrameCommand({
      url: "not-a-url",
      title: "Broken",
      frameId: Id.frame("frame_invalid"),
      geometry: { x: 0, y: 0, width: 1200, height: 800 }
    })).toEqual(Result.fail({ reason: "Enter a valid frame URL" }))
  })
})

describe("nextFrameGeometry", () => {
  it("tiles the first frame at the origin", () => {
    expect(nextFrameGeometry(0)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it("tiles the second frame in the first row", () => {
    expect(nextFrameGeometry(1)).toEqual({ x: 1240, y: 0, width: 1200, height: 800 })
  })

  it("tiles the fourth frame on the next row", () => {
    expect(nextFrameGeometry(3)).toEqual({ x: 0, y: 840, width: 1200, height: 800 })
  })
})
