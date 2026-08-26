import { Id } from "@crit/domain"
import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { canvasHref, parseHostCanvasId, sessionHash } from "../src/index.js"

describe("parseHostCanvasId", () => {
  it("accepts a CanvasId path param", () => {
    expect(parseHostCanvasId("canvas_shop")).toEqual(
      Result.succeed(Id.canvas("canvas_shop"))
    )
    expect(parseHostCanvasId("canvas_local")).toEqual(
      Result.succeed(Id.canvas("canvas_local"))
    )
  })

  it("rejects a value that is not a CanvasId", () => {
    expect(parseHostCanvasId("")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("shop")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("canvas_")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("Canvas_shop")).toEqual(Result.fail("invalid"))
  })
})

describe("canvasHref", () => {
  it("builds a canvas route that keeps the session hash", () => {
    expect(canvasHref(Id.canvas("canvas_shop"), "#crit=session")).toBe(
      "/canvas/canvas_shop#crit=session"
    )
    expect(sessionHash("#crit=session")).toBe("crit=session")
  })
})
