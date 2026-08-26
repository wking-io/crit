import { Id } from "@crit/domain"
import { Result } from "effect"
import { describe, expect, it } from "vitest"

import { localCanvasId, parseHostCanvasId } from "../src/index.js"

describe("parseHostCanvasId", () => {
  it("defaults to canvas_local when search is empty or has no canvas query", () => {
    expect(parseHostCanvasId("")).toEqual(Result.succeed(localCanvasId))
    expect(parseHostCanvasId("?foo=bar")).toEqual(Result.succeed(localCanvasId))
  })

  it("accepts a valid CanvasId from the first canvas query", () => {
    expect(parseHostCanvasId("?canvas=canvas_shop")).toEqual(
      Result.succeed(Id.canvas("canvas_shop"))
    )
    expect(parseHostCanvasId("?canvas=canvas_local")).toEqual(
      Result.succeed(localCanvasId)
    )
    expect(parseHostCanvasId("canvas=canvas_shop")).toEqual(
      Result.succeed(Id.canvas("canvas_shop"))
    )
    expect(parseHostCanvasId("?canvas=canvas_shop&canvas=canvas_other")).toEqual(
      Result.succeed(Id.canvas("canvas_shop"))
    )
  })

  it("fails when canvas is present and not a CanvasId", () => {
    expect(parseHostCanvasId("?canvas=")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("?canvas")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("?canvas=shop")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("?canvas=canvas_")).toEqual(Result.fail("invalid"))
    expect(parseHostCanvasId("?canvas=Canvas_shop")).toEqual(Result.fail("invalid"))
  })
})
