import { describe, expect, it } from "vitest"

import {
  connectBridgedFrameComments,
  CRIT_FRAME_COMMENT_SOURCE,
  critFrameCommentBridgeScript
} from "../../src/frame-bridge/comment-bridge.js"

describe("Frame Comment bridge", () => {
  it("configures one iframe and forwards frame-relative comment events", () => {
    let receive: ((event: MessageEvent) => void) | undefined
    let disconnected = false
    const target = {
      addEventListener: (_type: string, listener: EventListener) => {
        receive = listener as (event: MessageEvent) => void
      },
      removeEventListener: () => {
        disconnected = true
      }
    } as unknown as Window
    const posted: Array<unknown> = []
    const frameWindow = {
      postMessage: (value: unknown) => posted.push(value)
    } as unknown as Window
    const frameElement = { contentWindow: frameWindow } as unknown as HTMLIFrameElement
    const events: Array<unknown> = []
    const bridge = connectBridgedFrameComments({
      target,
      frameElement,
      onEvent: (event) => events.push(event)
    })

    bridge.configure({ activeId: "thread-1", enabled: true, color: "rebeccapurple", pins: [] })
    expect(posted).toEqual([{
      source: CRIT_FRAME_COMMENT_SOURCE,
      type: "configure",
      activeId: "thread-1",
      enabled: true,
      color: "rebeccapurple",
      pins: []
    }])

    receive?.({
      source: frameWindow,
      data: {
        source: CRIT_FRAME_COMMENT_SOURCE,
        type: "open",
        id: "thread-1"
      }
    } as MessageEvent)
    expect(events).toEqual([{
      type: "open",
      id: "thread-1"
    }])

    receive?.({
      source: {} as Window,
      data: { source: CRIT_FRAME_COMMENT_SOURCE, type: "ready" }
    } as MessageEvent)
    expect(events).toHaveLength(1)

    bridge.disconnect()
    expect(disconnected).toBe(true)
  })

  it("acknowledges configure only from the parent to close the ready race", () => {
    expect(critFrameCommentBridgeScript).toContain(
      "event.source !== window.parent"
    )
    expect(critFrameCommentBridgeScript).toContain('send({ type: "ready" })')
    expect(critFrameCommentBridgeScript).toContain("data-crit-comment-dot")
    expect(critFrameCommentBridgeScript).toContain("pin.id === activeId")
  })
})
