import { readFile } from "node:fs/promises"

import {
  decodeCanvasSharedWire,
  decodeShareCanvasWire,
  encodeCanvasSharedWire,
  encodeShareCanvasWire
} from "../src/index.js"
import { describe, expect, it } from "vitest"

const fixtureContents = (name: string) => readFile(
  new URL(`fixtures/${name}.json`, import.meta.url),
  "utf8"
)

const accessPerson = {
  _tag: "person" as const,
  personId: "person_ada",
  displayName: "Ada Lovelace",
  email: { _tag: "access" as const, address: "ada@acme.com" }
}

const shareFields = {
  kind: "share-canvas" as const,
  schemaVersion: 2 as const,
  canvasId: "canvas_checkout",
  title: "Checkout",
  shareId: "share_canvas_checkout",
  importId: "import_canvas_checkout",
  projectionDigest: `sha256:${"a".repeat(64)}`,
  person: accessPerson
}

const receiptFields = {
  kind: "canvas-shared" as const,
  schemaVersion: 2 as const,
  canvasId: "canvas_checkout",
  title: "Checkout",
  shareId: "share_canvas_checkout",
  importId: "import_canvas_checkout",
  projectionDigest: `sha256:${"a".repeat(64)}`,
  workspaceId: "workspace_default",
  personId: "person_ada"
}

describe("ShareCanvasWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input: unknown = JSON.parse(await fixtureContents("share-canvas"))
    const decoded = decodeShareCanvasWire(input)

    expect(encodeShareCanvasWire(decoded)).toEqual(input)
  })

  it("round-trips an anonymous Person email", () => {
    const input = {
      ...shareFields,
      person: {
        ...accessPerson,
        email: { _tag: "unspecified" as const }
      }
    }
    const decoded = decodeShareCanvasWire(input)

    expect(encodeShareCanvasWire(decoded)).toEqual(input)
  })

  it.each([
    ["excess property", { ...shareFields, extra: true }],
    ["wrong kind", { ...shareFields, kind: "canvas-share" }],
    ["wrong version", { ...shareFields, schemaVersion: 3 }],
    ["missing share ID", { ...shareFields, shareId: undefined }],
    ["missing import ID", { ...shareFields, importId: undefined }],
    ["missing projection digest", { ...shareFields, projectionDigest: undefined }],
    ["unbranded canvas ID", { ...shareFields, canvasId: "checkout" }]
  ])("rejects %s", (_label, input) => {
    expect(() => decodeShareCanvasWire(input)).toThrow()
  })
})

describe("CanvasSharedWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input: unknown = JSON.parse(await fixtureContents("canvas-shared"))
    const decoded = decodeCanvasSharedWire(input)

    expect(encodeCanvasSharedWire(decoded)).toEqual(input)
  })

  it.each([
    ["excess property", { ...receiptFields, extra: true }],
    ["wrong kind", { ...receiptFields, kind: "share-canvas" }],
    ["wrong version", { ...receiptFields, schemaVersion: 3 }],
    ["missing share ID", { ...receiptFields, shareId: undefined }],
    ["missing workspace ID", { ...receiptFields, workspaceId: undefined }]
  ])("rejects %s", (_label, input) => {
    expect(() => decodeCanvasSharedWire(input)).toThrow()
  })
})
