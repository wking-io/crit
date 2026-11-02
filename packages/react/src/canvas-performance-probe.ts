export type CanvasPerformanceSnapshot = {
  readonly interaction: string | null
  readonly durationMs: number
  readonly frames: number
  readonly fps: number
  readonly p95FrameMs: number
  readonly p99FrameMs: number
  readonly maxFrameMs: number
  readonly framesOver32Ms: number
  readonly longTasks: number
  readonly longTaskMs: number
  readonly eventCount: number
  readonly p95EventMs: number
  readonly domMutations: number
  readonly reactCommits: number
  readonly reactCommitMs: number
  readonly pointerMoves: number
}

type CanvasPerformanceProbe = {
  readonly enabled: true
  readonly snapshot: () => CanvasPerformanceSnapshot
}

declare global {
  interface Window {
    __critCanvasPerformance?: CanvasPerformanceProbe
  }
}

const percentile = (values: ReadonlyArray<number>, fraction: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

export const installCanvasPerformanceProbe = (): void => {
  if (!new URLSearchParams(window.location.search).has("crit-perf")) return
  let interaction: string | null = null
  let startedAt = 0
  let endedAt = 0
  let lastFrame: number | undefined
  let frameDeltas: number[] = []
  let longTaskDurations: number[] = []
  let eventDurations: number[] = []
  let domMutations = 0
  let reactCommits = 0
  let reactCommitMs = 0
  let pointerMoves = 0
  let wheelEnd = 0

  const active = () => interaction !== null && endedAt === 0
  const begin = (kind: string, timestamp: number) => {
    if (active()) return
    interaction = kind
    startedAt = timestamp
    endedAt = 0
    lastFrame = undefined
    frameDeltas = []
    longTaskDurations = []
    eventDurations = []
    domMutations = 0
    reactCommits = 0
    reactCommitMs = 0
    pointerMoves = 0
  }
  const end = (timestamp: number) => {
    if (!active()) return
    endedAt = timestamp
  }
  const frame = (timestamp: number) => {
    if (active()) {
      if (lastFrame !== undefined) frameDeltas.push(timestamp - lastFrame)
      lastFrame = timestamp
    }
    window.requestAnimationFrame(frame)
  }
  window.requestAnimationFrame(frame)

  window.addEventListener("pointerdown", (event) => begin("pointer", event.timeStamp), true)
  window.addEventListener("pointermove", () => {
    if (active()) pointerMoves += 1
  }, true)
  window.addEventListener("pointerup", (event) => {
    window.setTimeout(() => end(event.timeStamp + 200), 200)
  }, true)
  window.addEventListener("pointercancel", (event) => end(event.timeStamp), true)
  window.addEventListener("wheel", (event) => {
    begin("wheel", event.timeStamp)
    const generation = ++wheelEnd
    window.setTimeout(() => {
      if (generation === wheelEnd) end(event.timeStamp + 200)
    }, 200)
  }, { capture: true, passive: true })

  new MutationObserver((records) => {
    if (!active()) return
    domMutations += records.filter((record) =>
      record.target !== document.documentElement || record.attributeName !== "data-crit-performance"
    ).length
  }).observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true
  })

  const performanceObserver = globalThis.PerformanceObserver
  if (performanceObserver !== undefined) {
    const supported = performanceObserver.supportedEntryTypes
    if (supported.includes("longtask")) {
      new performanceObserver((list) => {
        if (!active()) return
        longTaskDurations.push(...list.getEntries().map((entry) => entry.duration))
      }).observe({ type: "longtask", buffered: true })
    }
    if (supported.includes("event")) {
      new performanceObserver((list) => {
        if (!active()) return
        eventDurations.push(...list.getEntries().map((entry) => entry.duration))
      }).observe({ type: "event", buffered: true })
    }
  }

  const probe: CanvasPerformanceProbe = {
    enabled: true,
    snapshot: () => {
      const finishedAt = endedAt === 0 ? performance.now() : endedAt
      const durationMs = interaction === null ? 0 : Math.max(0, finishedAt - startedAt)
      return {
        interaction,
        durationMs,
        frames: frameDeltas.length,
        fps: durationMs === 0 ? 0 : frameDeltas.length / (durationMs / 1_000),
        p95FrameMs: percentile(frameDeltas, 0.95),
        p99FrameMs: percentile(frameDeltas, 0.99),
        maxFrameMs: frameDeltas.length === 0 ? 0 : Math.max(...frameDeltas),
        framesOver32Ms: frameDeltas.filter((duration) => duration > 32).length,
        longTasks: longTaskDurations.length,
        longTaskMs: longTaskDurations.reduce((total, duration) => total + duration, 0),
        eventCount: eventDurations.length,
        p95EventMs: percentile(eventDurations, 0.95),
        domMutations,
        reactCommits,
        reactCommitMs,
        pointerMoves
      }
    }
  }
  window.__critCanvasPerformance = probe
  window.setInterval(() => {
    document.documentElement.dataset.critPerformance = JSON.stringify(probe.snapshot())
  }, 100)

  window.addEventListener("crit:react-commit", (event) => {
    if (
      !active() ||
      !(event instanceof CustomEvent) ||
      !Schema.is(Schema.Number)(event.detail)
    ) return
    reactCommits += 1
    reactCommitMs += event.detail
  })
}

export const recordCanvasReactCommit = (duration: number): void => {
  if (window.__critCanvasPerformance?.enabled !== true) return
  window.dispatchEvent(new CustomEvent("crit:react-commit", { detail: duration }))
}
import { Schema } from "effect"
