import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFrameMountQueue } from "../src/frame-mount-queue.js"

let dispose: Array<() => void> = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  dispose.forEach((cancel) => cancel())
  dispose = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const enqueue = (queue: ReturnType<typeof createFrameMountQueue>, mount: (ready: () => void) => void, priority = () => 0) => {
  const cancel = queue.enqueue(mount, priority)
  dispose.push(cancel)
  return cancel
}

describe("idle frame loading", () => {
  it("warms offscreen frames without waiting for them to intersect", () => {
    const queue = createFrameMountQueue()
    const mount = vi.fn((ready: () => void) => ready())
    enqueue(queue, mount, () => 100)
    vi.advanceTimersByTime(799)
    expect(mount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(mount).toHaveBeenCalledOnce()
  })
  it("keeps visible frames ahead of nearer and farther background frames", () => {
    const queue = createFrameMountQueue()
    const order: string[] = []
    for (const [name, priority] of [["far", 300], ["near", 100], ["visible", 0]] as const) {
      enqueue(queue, (ready) => { order.push(name); ready() }, () => priority)
    }
    vi.advanceTimersByTime(2500)
    expect(order).toEqual(["visible", "near", "far"])
  })
  it("admits only one background load until it completes", () => {
    const queue = createFrameMountQueue()
    let ready!: () => void
    const second = vi.fn()
    enqueue(queue, (complete) => { ready = complete }, () => 10)
    enqueue(queue, second, () => 20)
    vi.advanceTimersByTime(2000)
    expect(second).not.toHaveBeenCalled()
    ready()
    vi.advanceTimersByTime(1000)
    expect(second).toHaveBeenCalledOnce()
  })
  it("allows visible work past one background load, but bounds startup concurrency", () => {
    const queue = createFrameMountQueue()
    enqueue(queue, () => {}, () => 10)
    vi.advanceTimersByTime(1000)
    const visible = vi.fn()
    enqueue(queue, visible)
    enqueue(queue, visible)
    vi.advanceTimersByTime(1000)
    expect(visible).toHaveBeenCalledOnce()
  })
  it("postpones pending work throughout navigation, even when the queue was empty at first", () => {
    const queue = createFrameMountQueue()
    queue.postpone()
    const mount = vi.fn()
    enqueue(queue, mount)
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(40); queue.postpone() }
    expect(mount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(mount).toHaveBeenCalledOnce()
  })
  it("rechecks a queued frame's priority before starting it", () => {
    const queue = createFrameMountQueue()
    let priority = 100
    const mount = vi.fn()
    enqueue(queue, mount, () => priority)
    priority = 0
    queue.wake()
    vi.advanceTimersByTime(500)
    expect(mount).toHaveBeenCalledOnce()
  })
  it("does not force background work into a busy idle callback", () => {
    let callback!: IdleRequestCallback
    vi.stubGlobal("requestIdleCallback", vi.fn((fn) => { callback = fn; return 1 }))
    vi.stubGlobal("cancelIdleCallback", vi.fn())
    const queue = createFrameMountQueue()
    const mount = vi.fn()
    enqueue(queue, mount, () => 10)
    vi.advanceTimersByTime(1000)
    callback({ didTimeout: false, timeRemaining: () => 0 })
    expect(mount).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    callback({ didTimeout: false, timeRemaining: () => 20 })
    expect(mount).toHaveBeenCalledOnce()
  })
  it("cancels queued work and releases in-flight listeners on removal", () => {
    const queue = createFrameMountQueue()
    const cleanup = vi.fn()
    const cancel = enqueue(queue, () => cleanup)
    vi.advanceTimersByTime(500)
    cancel()
    const never = vi.fn()
    enqueue(queue, never)()
    vi.runAllTimers()
    expect(never).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("waits for pointer release before warming background frames", () => {
    const queue = createFrameMountQueue()
    const mount = vi.fn()
    enqueue(queue, mount, () => 10)
    document.dispatchEvent(new Event("pointerdown"))
    vi.advanceTimersByTime(2000)
    expect(mount).not.toHaveBeenCalled()
    document.dispatchEvent(new Event("pointerup"))
    vi.advanceTimersByTime(1000)
    expect(mount).toHaveBeenCalledOnce()
  })
  it("does no background loading in a hidden tab and resumes when visible", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    const queue = createFrameMountQueue()
    const mount = vi.fn()
    enqueue(queue, mount, () => 10)
    vi.advanceTimersByTime(2000)
    expect(mount).not.toHaveBeenCalled()
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event("visibilitychange"))
    vi.advanceTimersByTime(500)
    expect(mount).toHaveBeenCalledOnce()
    hidden.mockRestore()
  })
  it("recovers a slot if an iframe never reports load", () => {
    const queue = createFrameMountQueue()
    const next = vi.fn()
    enqueue(queue, () => {}, () => 10)
    enqueue(queue, next, () => 20)
    vi.advanceTimersByTime(12000)
    expect(next).toHaveBeenCalledOnce()
  })
})
