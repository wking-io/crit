import { readFile } from "node:fs/promises"

import {
  decodeCanvasSharedWire,
  decodeShareCanvasWire,
  encodeCanvasSharedWire,
  encodeShareCanvasWire
} from "../src/index.js"
import { describe, expect, it } from "vitest"

const fixture = async(name: string): Promise<unknown> => JSON.parse(
  await readFile(new URL(`fixtures/${name}.json`, import.meta.url), "utf8")
)

describe("ShareCanvasWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input = await fixture("share-canvas")
    const decoded = decodeShareCanvasWire(input)

    expect(encodeShareCanvasWire(decoded)).toEqual(input)
  })

  it.each([
    ["excess property", {
      kind: "share-canvas",
      schemaVersion: 1,
      canvasId: "canvas_checkout",
      title: "Checkout",
      person: {
        _tag: "person",
        personId: "person_ada",
        displayName: "Ada Lovelace",
        email: { _tag: "access", address: "ada@acme.com" }
      },
      extra: true
    }],
    ["wrong kind", {
      kind: "canvas-share",
      schemaVersion: 1,
      canvasId: "canvas_checkout",
      title: "Checkout",
      person: {
        _tag: "person",
        personId: "person_ada",
        displayName: "Ada Lovelace",
        email: { _tag: "access", address: "ada@acme.com" }
      }
    }],
    ["wrong version", {
      kind: "share-canvas",
      schemaVersion: 2,
      canvasId: "canvas_checkout",
      title: "Checkout",
      person: {
        _tag: "person",
        personId: "person_ada",
        displayName: "Ada Lovelace",
        email: { _tag: "access", address: "ada@acme.com" }
      }
    }],
    ["unspecified Person email", {
      kind: "share-canvas",
      schemaVersion: 1,
      canvasId: "canvas_checkout",
      title: "Checkout",
      person: {
        _tag: "person",
        personId: "person_ada",
        displayName: "Ada Lovelace",
        email: { _tag: "unspecified" }
      }
    }],
    ["unbranded canvas ID", {
      kind: "share-canvas",
      schemaVersion: 1,
      canvasId: "checkout",
      title: "Checkout",
      person: {
        _tag: "person",
        personId: "person_ada",
        displayName: "Ada Lovelace",
        email: { _tag: "access", address: "ada@acme.com" }
      }
    }]
  ])("rejects %s", (_label, input) => {
    expect(() => decodeShareCanvasWire(input)).toThrow()
  })
})

describe("CanvasSharedWire", () => {
  it("round-trips the versioned fixture", async() => {
    const input = await fixture("canvas-shared")
    const decoded = decodeCanvasSharedWire(input)

    expect(encodeCanvasSharedWire(decoded)).toEqual(input)
  })

  it.each([
    ["excess property", {
      kind: "canvas-shared",
      schemaVersion: 1,
      canvasId: "canvas_checkout",
      title: "Checkout",
      extra: true
    }],
    ["wrong kind", {
      kind: "share-canvas",
      schemaVersion: 1,
      canvasId: "canvas_checkout",
      title: "Checkout"
    }],
    ["wrong version", {
      kind: "canvas-shared",
      schemaVersion: 2,
      canvasId: "canvas_checkout",
      title: "Checkout"
    }]
  ])("rejects %s", (_label, input) => {
    expect(() => decodeCanvasSharedWire(input)).toThrow()
  })
})
