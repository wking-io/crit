import { readFile } from "node:fs/promises"

import { Id } from "@crit/domain"
import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  decodeSubmitCanvasChangeWire,
  encodeChangesAfterSearch,
  encodeSubmitCanvasChangeWire,
  parseChangesAfterSearch,
  parseRemoteAuthorityPath,
  remoteCanvasChangesPath,
  remoteCanvasPath,
  remoteChangesPageLimit
} from "../src/sync.js"

const fixtureContents = (name: string) => readFile(
  new URL(`fixtures/${name}.json`, import.meta.url),
  "utf8"
)

describe("remote authority protocol", () => {
  it("round-trips the submit fixture", async() => {
    const input: Schema.Json = JSON.parse(await fixtureContents("submit-canvas-change"))
    const decoded = decodeSubmitCanvasChangeWire(input)

    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isFailure(decoded)) return
    expect(encodeSubmitCanvasChangeWire(decoded.success)).toEqual(input)
    expect(decoded.success.proposal.changeId).toBe("change_a")
    expect(decoded.success.invocation._tag).toBe("person")
  })

  it("rejects a trusted field inside a nested command", async() => {
    const input = JSON.parse(await fixtureContents("submit-canvas-change"))
    input.change.commands[0].sequence = 1
    const decoded = decodeSubmitCanvasChangeWire(input)

    expect(Result.isFailure(decoded) && decoded.failure._tag).toBe("trustedField")
  })

  it("rejects an excess envelope property", async() => {
    const input = JSON.parse(await fixtureContents("submit-canvas-change"))
    input.extra = true
    const decoded = decodeSubmitCanvasChangeWire(input)

    expect(Result.isFailure(decoded) && decoded.failure._tag).toBe("envelopeInvalid")
  })

  it("parses canvas and changes paths", () => {
    const canvasId = Id.canvas("canvas_checkout")

    expect(parseRemoteAuthorityPath(remoteCanvasPath(canvasId))).toEqual({
      _tag: "canvas",
      canvasId
    })
    expect(parseRemoteAuthorityPath(remoteCanvasChangesPath(canvasId))).toEqual({
      _tag: "changes",
      canvasId
    })
    expect(parseRemoteAuthorityPath("/canvases")).toBeUndefined()
    expect(parseRemoteAuthorityPath("/canvases/not-a-canvas/changes")).toBeUndefined()
    expect(parseRemoteAuthorityPath("/identity")).toBeUndefined()
  })

  it("parses a cursor page query and defaults the limit", () => {
    const after = "cursor_a"
    const encoded = encodeChangesAfterSearch({ after, limit: 25 })

    expect(parseChangesAfterSearch(`?${encoded}`)).toEqual({ after, limit: 25 })
    expect(parseChangesAfterSearch("")).toEqual({
      after: null,
      limit: remoteChangesPageLimit
    })
    expect(parseChangesAfterSearch("after=&limit=08")).toBeUndefined()
    expect(parseChangesAfterSearch("limit=0")).toBeUndefined()
    expect(parseChangesAfterSearch("limit=1001")).toBeUndefined()
  })
})
