export const FRAME_MOUNT_QUIET_MS = 180
export const FRAME_BACKGROUND_QUIET_MS = 800
const FRAME_MOUNT_INTERVAL_MS = 100
const FRAME_LOAD_TIMEOUT_MS = 10_000

type Mount = (ready: () => void) => void | (() => void)
type Job = { readonly mount: Mount; readonly priority: () => number }

export const createFrameMountQueue = (document: Document = globalThis.document) => {
  const pending = new Set<Job>()
  const active = new Map<Job, () => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let idle: number | undefined
  let lastInput = Date.now()
  let lastMount = -Infinity
  let pointerHeld = false
  let listening = false

  const clearScheduled = () => {
    clearTimeout(timer)
    timer = undefined
    if (idle !== undefined) globalThis.cancelIdleCallback(idle)
    idle = undefined
  }
  const nextJob = () => {
    let next: Job | undefined
    for (const job of pending) {
      if (next === undefined || job.priority() < next.priority()) next = job
    }
    return next
  }
  const delayFor = (job: Job) => Math.max(
    0,
    (job.priority() === 0 ? FRAME_MOUNT_QUIET_MS : FRAME_BACKGROUND_QUIET_MS) - (Date.now() - lastInput),
    FRAME_MOUNT_INTERVAL_MS - (Date.now() - lastMount)
  )
  const hasCapacity = (job: Job) => active.size < (job.priority() === 0 ? 2 : 1)

  const detach = () => {
    if (!listening || pending.size > 0 || active.size > 0) return
    listening = false
    pointerHeld = false
    document.removeEventListener("wheel", postpone, true)
    document.removeEventListener("keydown", postpone, true)
    document.removeEventListener("pointerdown", pointerDown, true)
    document.removeEventListener("pointerup", pointerUp, true)
    document.removeEventListener("pointercancel", pointerUp, true)
    document.removeEventListener("visibilitychange", wake)
    document.defaultView?.removeEventListener("blur", pointerUp)
  }
  function wake() {
    clearScheduled()
    const next = nextJob()
    if (next === undefined) { detach(); return }
    if (document.hidden || pointerHeld || !hasCapacity(next)) return
    timer = setTimeout(() => {
      timer = undefined
      if (globalThis.requestIdleCallback !== undefined) {
        idle = globalThis.requestIdleCallback(flush,
          next.priority() === 0 ? { timeout: 200 } : undefined)
      } else {
        timer = setTimeout(() => flush(), 50)
      }
    }, delayFor(next))
  }
  function flush(deadline?: IdleDeadline) {
    idle = undefined
    timer = undefined
    const next = nextJob()
    if (next === undefined) { detach(); return }
    if (document.hidden || pointerHeld || !hasCapacity(next)) return
    if (delayFor(next) > 0) { wake(); return }
    if (deadline && deadline.timeRemaining() < 8 && !(next.priority() === 0 && deadline.didTimeout)) {
      timer = setTimeout(wake, 50)
      return
    }
    pending.delete(next)
    lastMount = Date.now()
    let cleanup: void | (() => void)
    const finish = () => {
      if (!active.delete(next)) return
      clearTimeout(watchdog)
      cleanup?.()
      wake()
    }
    const watchdog = setTimeout(finish, FRAME_LOAD_TIMEOUT_MS)
    active.set(next, finish)
    try {
      cleanup = next.mount(finish)
      if (!active.has(next)) cleanup?.()
    } catch (error) {
      finish()
      throw error
    }
    wake()
  }
  function postpone() { lastInput = Date.now(); wake() }
  function pointerDown() { pointerHeld = true; postpone() }
  function pointerUp() { pointerHeld = false; postpone() }
  const attach = () => {
    if (listening) return
    listening = true
    document.addEventListener("wheel", postpone, { capture: true, passive: true })
    document.addEventListener("keydown", postpone, true)
    document.addEventListener("pointerdown", pointerDown, true)
    document.addEventListener("pointerup", pointerUp, true)
    document.addEventListener("pointercancel", pointerUp, true)
    document.addEventListener("visibilitychange", wake)
    document.defaultView?.addEventListener("blur", pointerUp)
  }

  return {
    postpone,
    wake,
    enqueue(mount: Mount, priority: () => number = () => 0) {
      const job = { mount, priority }
      pending.add(job)
      attach()
      wake()
      return () => {
        pending.delete(job)
        active.get(job)?.()
        wake()
      }
    }
  }
}

const queues = new WeakMap<Element, ReturnType<typeof createFrameMountQueue>>()
export const frameMountQueueFor = (root: Element) => {
  let queue = queues.get(root)
  if (queue === undefined) {
    queue = createFrameMountQueue(root.ownerDocument)
    queues.set(root, queue)
  }
  return queue
}
