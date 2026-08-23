import {
  FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
  FRAME_COMMENT_BRIDGE_SOURCE,
  FrameBridgeOrigin,
  FrameCommentPinSchema,
  type FrameCommentDownMessage
} from "@crit/protocol"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  connectBridgedFrameComments,
  critFrameCommentBridgeScript
} from "../src/comment-bridge.js"
import type { FrameCommentUpEvent } from "@crit/protocol"

const frameOrigin = Schema.decodeUnknownSync(FrameBridgeOrigin)("https://shop.example")
const parentOrigin = Schema.decodeUnknownSync(FrameBridgeOrigin)("https://app.example")

const acceptsBrowserHandles = (
  target: Window,
  frameElement: HTMLIFrameElement,
  onEvent: (event: FrameCommentUpEvent) => void
) => connectBridgedFrameComments({ target, frameElement, frameOrigin, onEvent })
void acceptsBrowserHandles

const reviewPin = Schema.decodeUnknownSync(FrameCommentPinSchema)({
  id: "thread_review",
  anchor: {
    kind: "element",
    documentUrl: "https://shop.example/checkout",
    selector: "#buy",
    fingerprint: {
      tagName: "button",
      evidence: [{ kind: "id", value: "buy" }]
    },
    point: { x: 0.5, y: 0.25 }
  }
})

const selectAnchor = {
  kind: "element" as const,
  documentUrl: "https://shop.example/checkout",
  selector: "#buy",
  fingerprint: {
    tagName: "button",
    evidence: [{ kind: "id" as const, value: "buy" }]
  },
  point: { x: 0.5, y: 0.25 }
}

describe("Frame comment bridge", () => {
  it("configures one iframe and forwards frame-relative comment events", () => {
    let receive: ((event: {
      readonly origin: string
      readonly source: unknown
      readonly data: unknown
    }) => void) | undefined
    let disconnected = false
    const target = {
      addEventListener: (
        _type: "message",
        listener: (event: {
          readonly origin: string
          readonly source: unknown
          readonly data: unknown
        }) => void
      ) => {
        receive = listener
      },
      removeEventListener: () => {
        disconnected = true
        receive = undefined
      }
    }
    const posted: Array<{
      readonly message: FrameCommentDownMessage
      readonly targetOrigin: string
    }> = []
    const frameWindow = {
      postMessage: (value: FrameCommentDownMessage, targetOrigin: string) => {
        posted.push({ message: value, targetOrigin })
      }
    }
    const events: Array<unknown> = []
    const bridge = connectBridgedFrameComments({
      target,
      frameElement: { contentWindow: frameWindow },
      frameOrigin,
      onEvent: (event) => events.push(event)
    })

    bridge.configure({
      activeId: reviewPin.id,
      enabled: true,
      color: "rebeccapurple",
      pins: [reviewPin]
    })
    expect(posted).toEqual([{
      targetOrigin: frameOrigin,
      message: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: {
          type: "configure",
          activeId: "thread_review",
          enabled: true,
          color: "rebeccapurple",
          pins: [reviewPin]
        }
      }
    }])

    receive?.({
      origin: frameOrigin,
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "open", id: "thread_review" }
      }
    })
    expect(events).toEqual([{ type: "open", id: "thread_review" }])

    receive?.({
      origin: frameOrigin,
      source: {},
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "ready" }
      }
    })
    expect(events).toHaveLength(1)

    receive?.({
      origin: "https://evil.example",
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "ready" }
      }
    })
    expect(events).toHaveLength(1)

    receive?.({
      origin: frameOrigin,
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: {
          type: "select",
          anchor: { ...selectAnchor, point: { x: 2, y: 0 } }
        }
      }
    })
    expect(events).toHaveLength(1)

    bridge.disconnect()
    expect(disconnected).toBe(true)
    receive?.({
      origin: frameOrigin,
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "ready" }
      }
    })
    expect(events).toHaveLength(1)
  })

  it("serializes a parent-only configure handshake", () => {
    const script = critFrameCommentBridgeScript({ parentOrigin })
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain("event.source !== window.parent")
    expect(script).toContain("event.origin !== parentOrigin")
    expect(script).toContain("const configure = message.event")
    expect(script).toContain("pins = normalizePins(configure.pins)")
    expect(script).toContain("const acknowledgeReady = () => send({ type: \"ready\" })")
    expect(script).toContain("acknowledgeReady()")
    expect(script).toContain("data-crit-comment-dot")
    expect(script).toContain("pin.id === activeId")
    expect(script).toContain(
      `const schemaVersion = ${FRAME_COMMENT_BRIDGE_SCHEMA_VERSION}`
    )
    expect(script).toContain(
      `const source = "${FRAME_COMMENT_BRIDGE_SOURCE}"`
    )
    expect(script).toContain(`const parentOrigin = ${JSON.stringify(parentOrigin)}`)
    expect(script).toContain("postMessage({ source, schemaVersion, event }, parentOrigin)")
    expect(script).not.toContain(', "*"')
    expect(script).toContain("fingerprint?.evidence")
    expect(script).toContain('kind: "test-id"')
    expect(script).toContain("point.x")
    expect(script).not.toContain("typeof")
    expect(script).not.toContain("instanceof Element")
  })
})
