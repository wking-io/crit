import { Id } from "@crit/domain"
import { describe, expect, it } from "vitest"

import { HostLocation, parseHostLocation } from "../src/index.js"

describe("parseHostLocation", () => {
  it("is the index when search is empty or has no canvas query", () => {
    expect(parseHostLocation("")).toEqual(HostLocation.index())
    expect(parseHostLocation("?foo=bar")).toEqual(HostLocation.index())
  })

  it("opens a valid CanvasId from the first canvas query", () => {
    expect(parseHostLocation("?canvas=canvas_shop")).toEqual(
      HostLocation.canvas({ canvasId: Id.canvas("canvas_shop") })
    )
    expect(parseHostLocation("?canvas=canvas_local")).toEqual(
      HostLocation.canvas({ canvasId: Id.canvas("canvas_local") })
    )
    expect(parseHostLocation("canvas=canvas_shop")).toEqual(
      HostLocation.canvas({ canvasId: Id.canvas("canvas_shop") })
    )
    expect(parseHostLocation("?canvas=canvas_shop&canvas=canvas_other")).toEqual(
      HostLocation.canvas({ canvasId: Id.canvas("canvas_shop") })
    )
  })

  it("is invalid when canvas is present and not a CanvasId", () => {
    expect(parseHostLocation("?canvas=")).toEqual(HostLocation.invalid())
    expect(parseHostLocation("?canvas")).toEqual(HostLocation.invalid())
    expect(parseHostLocation("?canvas=shop")).toEqual(HostLocation.invalid())
    expect(parseHostLocation("?canvas=canvas_")).toEqual(HostLocation.invalid())
    expect(parseHostLocation("?canvas=Canvas_shop")).toEqual(HostLocation.invalid())
  })
})
