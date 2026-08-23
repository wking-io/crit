import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
  FRAME_COMMENT_BRIDGE_SOURCE,
  FRAME_INPUT_BRIDGE_SCHEMA_VERSION,
  FRAME_INPUT_BRIDGE_SOURCE,
  FrameBridgeOrigin,
  FrameCommentDownMessageSchema,
  FrameCommentUpEventSchema,
  FrameCommentUpMessageSchema,
  FrameInputBridgeMessageSchema,
  FrameInputIntentSchema,
  decodeFrameCommentDownMessage,
  decodeFrameCommentUpMessage,
  decodeFrameInputBridgeMessage,
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

const commentElement = {
  kind: "element" as const,
  documentUrl: "https://shop.example/checkout",
  selector: "#buy",
  fingerprint: {
    tagName: "button",
    evidence: [
      { kind: "id" as const, value: "buy" },
      { kind: "text" as const, value: "Buy now" }
    ]
  },
  point: { x: 0.5, y: 0.25 }
}

const commentEnvelope = {
  source: FRAME_COMMENT_BRIDGE_SOURCE,
  schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION
}

describe("Frame comment bridge protocol", () => {
  it("round-trips the versioned select fixture", async () => {
    const decoded = Schema.decodeUnknownSync(FrameCommentUpMessageSchema)(
      await fixture("frame-comment-up-select.json")
    )
    expect(decoded.source).toBe(FRAME_COMMENT_BRIDGE_SOURCE)
    expect(decoded.schemaVersion).toBe(FRAME_COMMENT_BRIDGE_SCHEMA_VERSION)
    expect(decoded.event.type).toBe("select")
    expect(Schema.encodeSync(FrameCommentUpMessageSchema)(decoded)).toEqual(
      await fixture("frame-comment-up-select.json")
    )
  })

  it("round-trips the versioned configure fixture", async () => {
    const decoded = Schema.decodeUnknownSync(FrameCommentDownMessageSchema)(
      await fixture("frame-comment-down-configure.json")
    )
    expect(decoded.event.type).toBe("configure")
    expect(decoded.event.activeId).toBe("thread_review")
    expect(Schema.encodeSync(FrameCommentDownMessageSchema)(decoded)).toEqual(
      await fixture("frame-comment-down-configure.json")
    )
  })

  it.each([
    ["ready", { type: "ready" }],
    ["open", { type: "open", id: "thread_1" }]
  ] as const)("round-trips a %s event", (_label, event) => {
    const decoded = Schema.decodeUnknownSync(FrameCommentUpEventSchema)(event)
    expect(Schema.encodeSync(FrameCommentUpEventSchema)(decoded)).toEqual(event)
    expect(Option.isSome(decodeFrameCommentUpMessage({
      ...commentEnvelope,
      event
    }))).toBe(true)
  })

  it.each([
    ["another schema version", {
      source: FRAME_COMMENT_BRIDGE_SOURCE,
      schemaVersion: 2,
      event: { type: "ready" }
    }],
    ["missing fields", {
      ...commentEnvelope,
      event: { type: "select" }
    }],
    ["excess property", {
      ...commentEnvelope,
      event: { type: "ready" },
      extra: true
    }],
    ["unbranded thread id", {
      ...commentEnvelope,
      event: { type: "open", id: "thread-1" }
    }],
    ["point outside 0..1", {
      ...commentEnvelope,
      event: {
        type: "select",
        anchor: { ...commentElement, point: { x: 1.1, y: 0.25 } }
      }
    }],
    ["empty selector", {
      ...commentEnvelope,
      event: {
        type: "select",
        anchor: { ...commentElement, selector: "" }
      }
    }],
    ["unsorted evidence", {
      ...commentEnvelope,
      event: {
        type: "select",
        anchor: {
          ...commentElement,
          fingerprint: {
            tagName: "button",
            evidence: [
              { kind: "text", value: "Buy now" },
              { kind: "id", value: "buy" }
            ]
          }
        }
      }
    }],
    ["duplicate evidence", {
      ...commentEnvelope,
      event: {
        type: "select",
        anchor: {
          ...commentElement,
          fingerprint: {
            tagName: "button",
            evidence: [
              { kind: "id", value: "buy" },
              { kind: "id", value: "buy" }
            ]
          }
        }
      }
    }]
  ])("rejects %s", (_label, input) => {
    expect(Option.isNone(decodeFrameCommentUpMessage(input))).toBe(true)
  })

  it("rejects a configure message with an unbranded pin id", () => {
    expect(Option.isNone(decodeFrameCommentDownMessage({
      source: FRAME_COMMENT_BRIDGE_SOURCE,
      schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
      event: {
        type: "configure",
        activeId: "thread-1",
        enabled: true,
        color: "rebeccapurple",
        pins: []
      }
    }))).toBe(true)
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
