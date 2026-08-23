import {
  FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
  FRAME_COMMENT_BRIDGE_SOURCE,
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

const acceptsBrowserHandles = (
  target: Window,
  frameElement: HTMLIFrameElement,
  onEvent: (event: FrameCommentUpEvent) => void
) => connectBridgedFrameComments({ target, frameElement, onEvent })
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
    let receive: ((event: { readonly source: unknown; readonly data: unknown }) => void) | undefined
    let disconnected = false
    const target = {
      addEventListener: (
        _type: "message",
        listener: (event: { readonly source: unknown; readonly data: unknown }) => void
      ) => {
        receive = listener
      },
      removeEventListener: () => {
        disconnected = true
        receive = undefined
      }
    }
    const posted: Array<FrameCommentDownMessage> = []
    const frameWindow = {
      postMessage: (value: FrameCommentDownMessage) => {
        posted.push(value)
      }
    }
    const events: Array<unknown> = []
    const bridge = connectBridgedFrameComments({
      target,
      frameElement: { contentWindow: frameWindow },
      onEvent: (event) => events.push(event)
    })

    bridge.configure({
      activeId: reviewPin.id,
      enabled: true,
      color: "rebeccapurple",
      pins: [reviewPin]
    })
    expect(posted).toEqual([{
      source: FRAME_COMMENT_BRIDGE_SOURCE,
      schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
      event: {
        type: "configure",
        activeId: "thread_review",
        enabled: true,
        color: "rebeccapurple",
        pins: [reviewPin]
      }
    }])

    receive?.({
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "open", id: "thread_review" }
      }
    })
    expect(events).toEqual([{ type: "open", id: "thread_review" }])

    receive?.({
      source: {},
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "ready" }
      }
    })
    expect(events).toHaveLength(1)

    receive?.({
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
    expect(() => new Function(critFrameCommentBridgeScript)).not.toThrow()
    expect(critFrameCommentBridgeScript).toContain("event.source !== window.parent")
    expect(critFrameCommentBridgeScript).toContain("const configure = message.event")
    expect(critFrameCommentBridgeScript).toContain("pins = normalizePins(configure.pins)")
    expect(critFrameCommentBridgeScript).toContain("const acknowledgeReady = () => send({ type: \"ready\" })")
    expect(critFrameCommentBridgeScript).toContain("acknowledgeReady()")
    expect(critFrameCommentBridgeScript).toContain("data-crit-comment-dot")
    expect(critFrameCommentBridgeScript).toContain("pin.id === activeId")
    expect(critFrameCommentBridgeScript).toContain(
      `const schemaVersion = ${FRAME_COMMENT_BRIDGE_SCHEMA_VERSION}`
    )
    expect(critFrameCommentBridgeScript).toContain(
      `const source = "${FRAME_COMMENT_BRIDGE_SOURCE}"`
    )
    expect(critFrameCommentBridgeScript).toContain("fingerprint?.evidence")
    expect(critFrameCommentBridgeScript).toContain('kind: "test-id"')
    expect(critFrameCommentBridgeScript).toContain("point.x")
    expect(critFrameCommentBridgeScript).not.toContain("typeof")
    expect(critFrameCommentBridgeScript).not.toContain("instanceof Element")
  })
})
