import { describe, expect, it } from "vitest"

import {
  connectBridgedFrameComments,
  CRIT_FRAME_COMMENT_SOURCE,
  critFrameCommentBridgeScript
} from "../../src/frame-bridge/comment-bridge.js"

describe("Frame Comment bridge", () => {
  it("configures one iframe and forwards frame-relative comment events", () => {
    let receive: ((event: { readonly source: unknown; readonly data: unknown }) => void) | undefined
    let disconnected = false
    const target = {
      addEventListener: (_type: "message", listener: typeof receive) => {
        receive = listener
      },
      removeEventListener: () => {
        disconnected = true
      }
    }
    const posted: Array<unknown> = []
    const frameWindow = {
      postMessage: (value: unknown) => posted.push(value)
    }
    const frameElement = { contentWindow: frameWindow }
    const events: Array<unknown> = []
    const bridge = connectBridgedFrameComments({
      target,
      frameElement,
      onEvent: (event) => events.push(event)
    })

    bridge.configure({ activeId: "thread-1", enabled: true, color: "rebeccapurple", pins: [] })
    expect(posted).toEqual([{
      source: CRIT_FRAME_COMMENT_SOURCE,
      event: {
        type: "configure",
        activeId: "thread-1",
        enabled: true,
        color: "rebeccapurple",
        pins: []
      }
    }])

    receive?.({
      source: frameWindow,
      data: {
        source: CRIT_FRAME_COMMENT_SOURCE,
        event: {
          type: "open",
          id: "thread-1"
        }
      }
    })
    expect(events).toEqual([{
      type: "open",
      id: "thread-1"
    }])

    receive?.({
      source: {},
      data: {
        source: CRIT_FRAME_COMMENT_SOURCE,
        event: { type: "ready" }
      }
    })
    expect(events).toHaveLength(1)

    receive?.({
      source: frameWindow,
      data: {
        source: CRIT_FRAME_COMMENT_SOURCE,
        event: {
          type: "select",
          anchor: { kind: "element", xRatio: 2, yRatio: 0 }
        }
      }
    })
    expect(events).toHaveLength(1)

    bridge.disconnect()
    expect(disconnected).toBe(true)
  })

  it("acknowledges configure only from the parent to close the ready race", () => {
    expect(() => new Function(critFrameCommentBridgeScript)).not.toThrow()
    expect(critFrameCommentBridgeScript).toContain(
      "event.source !== window.parent"
    )
    expect(critFrameCommentBridgeScript).toContain("const configure = message.event")
    expect(critFrameCommentBridgeScript).toContain(
      "pins = normalizePins(configure.pins)"
    )
    expect(critFrameCommentBridgeScript).toContain('send({ type: "ready" })')
    expect(critFrameCommentBridgeScript).toContain("data-crit-comment-dot")
    expect(critFrameCommentBridgeScript).toContain("pin.id === activeId")
    expect(critFrameCommentBridgeScript).not.toContain("typeof")
    expect(critFrameCommentBridgeScript).not.toContain("instanceof Element")
  })
})
