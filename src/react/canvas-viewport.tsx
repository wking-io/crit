import { Effect } from "effect"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react"

import {
  CanvasCommand,
  type CanvasCommandFailed,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry,
  type CanvasNote,
  type CanvasCommand as CanvasCommandValue,
  type FrameReviewStatus,
  type FrameStatus
} from "../core/index.js"

const statusLabels: Record<FrameStatus, string> = {
  "in-progress": "In progress",
  approved: "Approved",
  "changes-requested": "Changes requested",
  archived: "Archived"
}

const statusColors: Record<FrameStatus, string> = {
  "in-progress": "#2563eb",
  approved: "#16803a",
  "changes-requested": "#c2410c",
  archived: "#64748b"
}

type Camera = { readonly x: number; readonly y: number; readonly zoom: number }
type Preview = Readonly<Record<string, CanvasGeometry>>
export type FrameToolbarMode = "full" | "compact" | "minimal"

export const frameToolbarMode = (visualWidth: number): FrameToolbarMode =>
  visualWidth >= 520 ? "full" : visualWidth >= 260 ? "compact" : "minimal"

export interface CanvasViewportProps {
  readonly document: CanvasDocument
  readonly dispatch: (
    ...commands: ReadonlyArray<CanvasCommandValue>
  ) => Effect.Effect<unknown, CanvasCommandFailed>
  readonly iframeAllow?: string
  readonly iframeSandbox?: string
  readonly onCommandError?: (message: string) => void
  readonly snapshotFrame?: (
    frameId: string
  ) => Effect.Effect<unknown, unknown>
}

const itemStyle = (geometry: CanvasGeometry, zIndex: number): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})

const messageOf = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "detail" in cause
    ? String(cause.detail)
    : cause instanceof Error
      ? cause.message
      : String(cause)

const localId = (prefix: string) =>
  `${prefix}-${
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`

const intersectsViewport = (
  geometry: CanvasGeometry,
  camera: Camera,
  width: number,
  height: number
) => {
  const margin = 500
  const left = geometry.x * camera.zoom + camera.x
  const top = geometry.y * camera.zoom + camera.y
  const right = left + geometry.width * camera.zoom
  const bottom = top + geometry.height * camera.zoom
  return (
    right >= -margin &&
    bottom >= -margin &&
    left <= width + margin &&
    top <= height + margin
  )
}

export function CanvasViewport({
  document,
  dispatch,
  iframeAllow = "clipboard-read; clipboard-write; fullscreen",
  iframeSandbox,
  onCommandError,
  snapshotFrame
}: CanvasViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<Camera>({ x: 40, y: 40, zoom: 0.65 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [preview, setPreview] = useState<Preview>({})

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const update = () =>
      setViewport({ width: root.clientWidth, height: root.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const run = useCallback(
    (...commands: ReadonlyArray<CanvasCommandValue>) => {
      Effect.runFork(
        dispatch(...commands).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => onCommandError?.(messageOf(cause)))
          )
        )
      )
    },
    [dispatch, onCommandError]
  )

  const geometryOf = useCallback(
    (item: CanvasFrame | CanvasNote) => preview[item.id] ?? item.geometry,
    [preview]
  )

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const start = { x: event.clientX, y: event.clientY, camera }
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) =>
      setCamera({
        ...start.camera,
        x: start.camera.x + next.clientX - start.x,
        y: start.camera.y + next.clientY - start.y
      })
    const end = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
  }

  const zoom = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const nextZoom = Math.min(2, Math.max(0.1, camera.zoom * Math.exp(-event.deltaY * 0.003)))
      const worldX = (pointerX - camera.x) / camera.zoom
      const worldY = (pointerY - camera.y) / camera.zoom
      setCamera({
        zoom: nextZoom,
        x: pointerX - worldX * nextZoom,
        y: pointerY - worldY * nextZoom
      })
      return
    }
    setCamera((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY
    }))
  }

  const startMove = (
    event: ReactPointerEvent,
    item: CanvasFrame | CanvasNote
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, geometry: geometryOf(item) }
    const attached = "url" in item
      ? document.notes.filter((note) => note.attachedTo === item.id)
      : []
    const move = (next: PointerEvent) => {
      const deltaX = (next.clientX - start.x) / camera.zoom
      const deltaY = (next.clientY - start.y) / camera.zoom
      const geometry = {
        ...start.geometry,
        x: start.geometry.x + deltaX,
        y: start.geometry.y + deltaY
      }
      setPreview((current) => ({
        ...current,
        [item.id]: geometry,
        ...Object.fromEntries(attached.map((note) => [
          note.id,
          {
            ...note.geometry,
            x: note.geometry.x + deltaX,
            y: note.geometry.y + deltaY
          }
        ]))
      }))
    }
    const end = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      const geometry = {
        ...start.geometry,
        x: start.geometry.x + (next.clientX - start.x) / camera.zoom,
        y: start.geometry.y + (next.clientY - start.y) / camera.zoom
      }
      setPreview((current) => {
        const removedIds = new Set([item.id, ...attached.map((note) => note.id)])
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => !removedIds.has(id))
        )
      })
      if ("url" in item) {
        run(CanvasCommand.moveFrame({ id: item.id, x: geometry.x, y: geometry.y }))
        return
      }
      const centerX = geometry.x + geometry.width / 2
      const centerY = geometry.y + geometry.height / 2
      const parent = document.frames.find((frame) => {
        const bounds = geometryOf(frame)
        return (
          centerX >= bounds.x && centerX <= bounds.x + bounds.width &&
          centerY >= bounds.y && centerY <= bounds.y + bounds.height
        )
      })
      const commands: Array<CanvasCommandValue> = [
        CanvasCommand.moveNote({ id: item.id, x: geometry.x, y: geometry.y })
      ]
      if (parent !== undefined && item.attachedTo !== parent.id) {
        commands.push(CanvasCommand.attachNote({ id: item.id, frameId: parent.id }))
      } else if (parent === undefined && item.attachedTo !== null) {
        commands.push(CanvasCommand.detachNote({ id: item.id }))
      }
      run(...commands)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
  }

  const startResize = (
    event: ReactPointerEvent,
    item: CanvasFrame | CanvasNote
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, geometry: geometryOf(item) }
    const move = (next: PointerEvent) => {
      const geometry = {
        ...start.geometry,
        width: Math.max(180, start.geometry.width + (next.clientX - start.x) / camera.zoom),
        height: Math.max(120, start.geometry.height + (next.clientY - start.y) / camera.zoom)
      }
      setPreview((current) => ({ ...current, [item.id]: geometry }))
    }
    const end = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      const width = Math.max(180, start.geometry.width + (next.clientX - start.x) / camera.zoom)
      const height = Math.max(120, start.geometry.height + (next.clientY - start.y) / camera.zoom)
      setPreview((current) => {
        const { [item.id]: _removed, ...rest } = current
        return rest
      })
      run(
        "url" in item
          ? CanvasCommand.resizeFrame({ id: item.id, width, height })
          : CanvasCommand.resizeNote({ id: item.id, width, height })
      )
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end, { once: true })
  }

  const fit = () => {
    const items = [...document.frames, ...document.notes]
    if (items.length === 0) {
      setCamera({ x: 40, y: 40, zoom: 0.65 })
      return
    }
    const left = Math.min(...items.map((item) => item.geometry.x))
    const top = Math.min(...items.map((item) => item.geometry.y))
    const right = Math.max(...items.map((item) => item.geometry.x + item.geometry.width))
    const bottom = Math.max(...items.map((item) => item.geometry.y + item.geometry.height))
    const nextZoom = Math.min(1, Math.max(0.1, Math.min(
      (viewport.width - 80) / Math.max(1, right - left),
      (viewport.height - 80) / Math.max(1, bottom - top)
    )))
    setCamera({
      zoom: nextZoom,
      x: (viewport.width - (right - left) * nextZoom) / 2 - left * nextZoom,
      y: (viewport.height - (bottom - top) * nextZoom) / 2 - top * nextZoom
    })
  }

  const sortedItems = useMemo(
    () =>
      [...document.frames, ...document.notes].sort(
        (left, right) => left.zIndex - right.zIndex
      ),
    [document]
  )

  return (
    <div
      ref={rootRef}
      onPointerDown={startPan}
      onWheel={zoom}
      style={{
        backgroundColor: "#e8ebef",
        backgroundImage: "radial-gradient(#aeb5bf 1px, transparent 1px)",
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
        cursor: "grab",
        height: "100%",
        minHeight: 420,
        overflow: "hidden",
        position: "relative",
        touchAction: "none",
        width: "100%"
      }}
    >
      <div
        style={{
          height: 0,
          left: 0,
          position: "absolute",
          top: 0,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          transformOrigin: "0 0",
          width: 0
        }}
      >
        {sortedItems.map((item) =>
          "url" in item ? (
            <FrameCard
              key={item.id}
              frame={item}
              geometry={geometryOf(item)}
              zoom={camera.zoom}
              iframeAllow={iframeAllow}
              {...(iframeSandbox === undefined ? {} : { iframeSandbox })}
              iframeVisible={intersectsViewport(
                geometryOf(item), camera, viewport.width, viewport.height
              )}
              onMove={startMove}
              onRemove={() => run(CanvasCommand.removeFrame({ id: item.id }))}
              onResize={startResize}
              {...(snapshotFrame === undefined
                ? {}
                : { onSnapshot: () => snapshotFrame(item.id) })}
              onSnapshotError={(cause) => onCommandError?.(messageOf(cause))}
              onStatus={(status) =>
                run(CanvasCommand.setFrameStatus({ id: item.id, status }))
              }
            />
          ) : (
            <NoteCard
              key={item.id}
              note={item}
              geometry={geometryOf(item)}
              onMove={startMove}
              onRemove={() => run(CanvasCommand.removeNote({ id: item.id }))}
              onResize={startResize}
              onText={(expectedText, text) =>
                run(CanvasCommand.updateNote({ id: item.id, expectedText, text }))
              }
            />
          )
        )}
      </div>
      <div style={{ display: "flex", gap: 6, left: 12, position: "absolute", top: 12 }}>
        <button
          onClick={() => {
            const id = localId("note")
            run(CanvasCommand.addNote({
              id,
              text: "",
              x: (viewport.width / 2 - camera.x) / camera.zoom - 140,
              y: (viewport.height / 2 - camera.y) / camera.zoom - 80
            }))
          }}
          type="button"
        >
          Add note
        </button>
        <button onClick={fit} type="button">Fit</button>
        <span style={{ background: "#fff", borderRadius: 4, padding: "5px 8px" }}>
          {Math.round(camera.zoom * 100)}%
        </span>
      </div>
    </div>
  )
}

function FrameCard({
  frame,
  geometry,
  iframeAllow,
  iframeSandbox,
  iframeVisible,
  zoom,
  onMove,
  onRemove,
  onResize,
  onSnapshot,
  onSnapshotError,
  onStatus
}: {
  readonly frame: CanvasFrame
  readonly geometry: CanvasGeometry
  readonly iframeAllow: string
  readonly iframeSandbox?: string
  readonly iframeVisible: boolean
  readonly zoom: number
  readonly onMove: (event: ReactPointerEvent, item: CanvasFrame) => void
  readonly onRemove: () => void
  readonly onResize: (event: ReactPointerEvent, item: CanvasFrame) => void
  readonly onSnapshot?: () => Effect.Effect<unknown, unknown>
  readonly onSnapshotError: (cause: unknown) => void
  readonly onStatus: (status: FrameReviewStatus) => void
}) {
  const [snapshotting, setSnapshotting] = useState(false)
  const visualWidth = geometry.width * zoom
  const toolbarMode = frameToolbarMode(visualWidth)
  const world = (pixels: number) => pixels / zoom
  const toolbarHeight = Math.min(geometry.height, world(36))
  const controlStyle: CSSProperties = {
    boxSizing: "border-box",
    fontSize: world(12),
    height: world(24),
    lineHeight: `${world(16)}px`,
    padding: `0 ${world(6)}px`
  }
  const takeSnapshot = () => {
    if (onSnapshot === undefined || snapshotting) return
    setSnapshotting(true)
    Effect.runFork(
      onSnapshot().pipe(
        Effect.tapError((cause) => Effect.sync(() => onSnapshotError(cause))),
        Effect.ensuring(Effect.sync(() => setSnapshotting(false))),
        Effect.catch(() => Effect.void)
      )
    )
  }

  return (
    <section style={{ ...itemStyle(geometry, frame.zIndex), background: "#fff", border: "1px solid #aeb5bf", borderRadius: 8, boxShadow: "0 12px 30px rgba(15,23,42,.12)", overflow: "hidden" }}>
      <header
        data-toolbar-mode={toolbarMode}
        onPointerDown={(event) => onMove(event, frame)}
        style={{
          alignItems: "center",
          background: "#f8fafc",
          boxSizing: "border-box",
          cursor: "move",
          display: "flex",
          fontSize: world(13),
          gap: world(8),
          height: toolbarHeight,
          lineHeight: `${world(16)}px`,
          padding: `0 ${world(10)}px`
        }}
      >
        <span style={{ background: statusColors[frame.status], borderRadius: 999, flex: "0 0 auto", height: world(8), width: world(8) }} />
        {toolbarMode === "full" ? (
          <strong
            title={frame.title}
            style={{
              flex: 1,
              maxWidth: world(240),
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {frame.title}
          </strong>
        ) : null}
        {frame.snapshot === undefined && toolbarMode !== "minimal" ? (
          <select
            aria-label={`Status for ${frame.title}`}
            onChange={(event) =>
              onStatus(event.currentTarget.value as FrameReviewStatus)
            }
            onPointerDown={(event) => event.stopPropagation()}
            style={{ ...controlStyle, maxWidth: world(140) }}
            value={frame.status}
          >
            {(["in-progress", "approved", "changes-requested"] as const).map(
              (status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              )
            )}
          </select>
        ) : frame.snapshot !== undefined && toolbarMode !== "minimal" ? (
          <small style={{ fontSize: world(12) }}>{statusLabels.archived}</small>
        ) : null}
        {frame.snapshot === undefined && onSnapshot !== undefined && toolbarMode === "full" ? (
          <button
            disabled={snapshotting}
            onClick={takeSnapshot}
            onPointerDown={(event) => event.stopPropagation()}
            style={controlStyle}
            type="button"
          >
            {snapshotting ? "Archiving…" : "Take snapshot"}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        {toolbarMode !== "minimal" ? (
          <a
            aria-label={`Open ${frame.title}`}
            href={frame.url}
            onPointerDown={(event) => event.stopPropagation()}
            rel="noreferrer"
            style={{ fontSize: world(14), lineHeight: `${world(20)}px` }}
            target="_blank"
          >
            ↗
          </a>
        ) : null}
        <button
          aria-label={`Delete ${frame.title}`}
          onClick={onRemove}
          onPointerDown={(event) => event.stopPropagation()}
          style={controlStyle}
          type="button"
        >
          ×
        </button>
      </header>
      <div style={{ height: `calc(100% - ${toolbarHeight}px)`, position: "relative" }}>
        {iframeVisible ? (
          <iframe
            allow={iframeAllow}
            referrerPolicy="no-referrer"
            sandbox={iframeSandbox}
            src={frame.url}
            title={frame.title}
            style={{ border: 0, height: "100%", width: "100%" }}
          />
        ) : <div style={{ color: "#64748b", padding: 24 }}>Frame paused while offscreen</div>}
      </div>
      <ResizeHandle onPointerDown={(event) => onResize(event, frame)} />
    </section>
  )
}

function NoteCard({
  note,
  geometry,
  onMove,
  onRemove,
  onResize,
  onText
}: {
  readonly note: CanvasNote
  readonly geometry: CanvasGeometry
  readonly onMove: (event: ReactPointerEvent, item: CanvasNote) => void
  readonly onRemove: () => void
  readonly onResize: (event: ReactPointerEvent, item: CanvasNote) => void
  readonly onText: (expectedText: string, text: string) => void
}) {
  const [text, setText] = useState(note.text)
  useEffect(() => setText(note.text), [note.text])
  return (
    <article style={{ ...itemStyle(geometry, note.zIndex), background: "#fff7b3", border: "1px solid #d6c662", borderRadius: 6, boxShadow: "0 6px 18px rgba(15,23,42,.12)", overflow: "hidden" }}>
      <header
        onPointerDown={(event) => onMove(event, note)}
        style={{ alignItems: "center", cursor: "move", display: "flex", height: 28, justifyContent: "space-between", padding: "0 8px" }}
      >
        <small>{note.attachedTo === null ? "Note" : `Attached to ${note.attachedTo}`}</small>
        <button aria-label="Delete note" onClick={onRemove} onPointerDown={(event) => event.stopPropagation()} type="button">×</button>
      </header>
      <textarea
        aria-label="Note"
        onBlur={() => text !== note.text && onText(note.text, text)}
        onChange={(event) => setText(event.currentTarget.value)}
        value={text}
        style={{ background: "transparent", border: 0, boxSizing: "border-box", height: "calc(100% - 28px)", outline: 0, padding: 10, resize: "none", width: "100%" }}
      />
      <ResizeHandle onPointerDown={(event) => onResize(event, note)} />
    </article>
  )
}

function ResizeHandle({ onPointerDown }: { readonly onPointerDown: (event: ReactPointerEvent) => void }) {
  return <div aria-label="Resize" onPointerDown={onPointerDown} style={{ bottom: 0, cursor: "nwse-resize", height: 16, position: "absolute", right: 0, width: 16 }} />
}
