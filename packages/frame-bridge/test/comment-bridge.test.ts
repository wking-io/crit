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

const commentTarget = (target: EventTarget): Window => {
  // SAFETY: This fixture supplies addEventListener and removeEventListener,
  // the only Window members read by connectBridgedFrameComments.
  return target as Window
}

const commentContentWindow = (
  host: { readonly postMessage: (message: FrameCommentDownMessage, targetOrigin: string) => void }
): Window => {
  // SAFETY: configure only calls postMessage; receive compares event.source
  // to this object by identity.
  return host as Window
}

const commentFrame = (contentWindow: Window): HTMLIFrameElement => {
  const frame = { contentWindow }
  // SAFETY: This fixture supplies contentWindow, the only HTMLIFrameElement
  // member read by connectBridgedFrameComments.
  return frame as HTMLIFrameElement
}

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
    const target = new EventTarget()
    const posted: Array<FrameCommentDownMessage> = []
    const frameWindow = commentContentWindow({
      postMessage: (value) => {
        posted.push(value)
      }
    })
    const events: Array<unknown> = []
    const bridge = connectBridgedFrameComments({
      target: commentTarget(target),
      frameElement: commentFrame(frameWindow),
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

    target.dispatchEvent(new MessageEvent("message", {
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "open", id: "thread_review" }
      }
    }))
    expect(events).toEqual([{ type: "open", id: "thread_review" }])

    target.dispatchEvent(new MessageEvent("message", {
      source: commentTarget(new EventTarget()),
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "ready" }
      }
    }))
    expect(events).toHaveLength(1)

    target.dispatchEvent(new MessageEvent("message", {
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: {
          type: "select",
          anchor: { ...selectAnchor, point: { x: 2, y: 0 } }
        }
      }
    }))
    expect(events).toHaveLength(1)

    bridge.disconnect()
    target.dispatchEvent(new MessageEvent("message", {
      source: frameWindow,
      data: {
        source: FRAME_COMMENT_BRIDGE_SOURCE,
        schemaVersion: FRAME_COMMENT_BRIDGE_SCHEMA_VERSION,
        event: { type: "ready" }
      }
    }))
    expect(events).toHaveLength(1)
  })

  it("serializes a parent-only configure handshake", () => {
    expect(() => new Function(critFrameCommentBridgeScript)).not.toThrow()
    expect(critFrameCommentBridgeScript).toContain("event.source !== window.parent")
    expect(critFrameCommentBridgeScript).toContain("const configure = message.event")
    expect(critFrameCommentBridgeScript).toContain("pins = normalizePins(configure.pins)")
    expect(critFrameCommentBridgeScript).toContain('send({ type: "ready" })')
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
