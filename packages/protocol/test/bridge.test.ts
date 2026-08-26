import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE,
  FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
  FRAME_ROUTE_BRIDGE_SOURCE,
  FrameBridgeOrigin,
  FrameInputBridgeMessageSchema,
  FrameInputIntentSchema,
  FrameRouteBridgeMessageSchema,
  decodeFrameInputBridgeMessage,
  decodeFrameRouteBridgeMessage,
  type FrameInputIntent
} from "../src/index.js"

const fixture = async (name: string) =>
  JSON.parse(await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", name),
    "utf8"
  ))

const envelope = (intent: FrameInputIntent) => ({
  source: FRAME_INPUT_BRIDGE_SOURCE,
  schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  intent
})

describe("Frame input bridge protocol", () => {
  it("round-trips the versioned fixture", async () => {
    const decoded = Schema.decodeUnknownSync(FrameInputBridgeMessageSchema)(
      await fixture("frame-input-bridge.json")
    )
    expect(decoded.source).toBe(FRAME_INPUT_BRIDGE_SOURCE)
    expect(decoded.schemaVersion).toBe(FRAME_INPUT_BRIDGE_SCHEMA_VERSION)
    expect(decoded.intent.type).toBe("wheel")
    expect(Schema.encodeSync(FrameInputBridgeMessageSchema)(decoded)).toEqual(
      await fixture("frame-input-bridge.json")
    )
  })

  it.each([
    ["select", { type: "select", additive: true }],
    ["delete", { type: "delete" }],
    ["tool", { type: "tool", tool: "pan" }],
    ["zoom-step", { type: "zoom-step", direction: -1 }],
    ["pinch", {
      type: "pinch",
      clientX: 10,
      clientY: 20,
      deltaX: 1,
      deltaY: 2,
      scaleFactor: 1.25
    }]
  ] as const)("round-trips a %s intent", (_label, intent) => {
    const decoded = Schema.decodeUnknownSync(FrameInputIntentSchema)(intent)
    expect(Schema.encodeSync(FrameInputIntentSchema)(decoded)).toEqual(intent)
    expect(Option.isSome(decodeFrameInputBridgeMessage(envelope(intent)))).toBe(true)
  })

  it.each([
    ["another schema version", {
      source: FRAME_INPUT_BRIDGE_SOURCE,
      schemaVersion: 2,
      intent: { type: "delete" }
    }],
    ["missing additive", {
      source: FRAME_INPUT_BRIDGE_SOURCE,
      schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
      intent: { type: "select" }
    }],
    ["non-positive pinch scale", {
      source: FRAME_INPUT_BRIDGE_SOURCE,
      schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
      intent: {
        type: "pinch",
        clientX: 10,
        clientY: 20,
        deltaX: 1,
        deltaY: 2,
        scaleFactor: 0
      }
    }],
    ["non-finite wheel delta", {
      source: FRAME_INPUT_BRIDGE_SOURCE,
      schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
      intent: {
        type: "wheel",
        clientX: 20,
        clientY: 30,
        ctrlKey: false,
        metaKey: false,
        deltaX: Number.NaN,
        deltaY: 8
      }
    }],
    ["wrong source", {
      source: "@riff-refine/crit/frame-input",
      schemaVersion: FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
      intent: { type: "delete" }
    }],
    ["excess property", {
      ...envelope({ type: "delete" }),
      extra: true
    }],
    ["null", null],
    ["string", "bridge"]
  ])("rejects %s", (_label, input) => {
    expect(Option.isNone(decodeFrameInputBridgeMessage(input))).toBe(true)
  })
})

describe("Frame route bridge protocol", () => {
  it.each([
    "/checkout",
    "/checkout?x=1",
    "/checkout/"
  ])("round-trips %s", (route) => {
    const input = {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route
    }
    const decoded = Schema.decodeUnknownSync(FrameRouteBridgeMessageSchema)(input)
    expect(Schema.encodeSync(FrameRouteBridgeMessageSchema)(decoded)).toEqual(input)
    expect(decodeFrameRouteBridgeMessage(input)).toEqual(Option.some(decoded))
  })

  it.each([
    ["version 2", {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: 2,
      route: "/checkout"
    }],
    ["a fragment", {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "/checkout#payment"
    }],
    ["a URL", {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "https://shop.example/checkout"
    }],
    ["an excess property", {
      source: FRAME_ROUTE_BRIDGE_SOURCE,
      schemaVersion: FRAME_ROUTE_BRIDGE_SCHEMA_VERSION,
      route: "/checkout",
      extra: true
    }]
  ])("rejects %s", (_label, input) => {
    expect(Option.isNone(decodeFrameRouteBridgeMessage(input))).toBe(true)
  })
})

const decodeOrigin = Schema.decodeUnknownOption(FrameBridgeOrigin)

describe("Frame bridge origin", () => {
  it.each([
    "https://review.example",
    "http://127.0.0.1:5173"
  ])("accepts %s", (value) => {
    expect(Option.isSome(decodeOrigin(value))).toBe(true)
  })

  it.each([
    ["trailing slash", "https://review.example/"],
    ["path", "https://review.example/path"],
    ["opaque null", "null"],
    ["credentials", "https://user:pass@review.example"],
    ["non-http", "ftp://review.example"],
    ["default https port", "https://review.example:443"]
  ])("rejects %s", (_label, value) => {
    expect(Option.isNone(decodeOrigin(value))).toBe(true)
  })
})
