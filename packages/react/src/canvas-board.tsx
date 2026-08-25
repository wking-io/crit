import {
  type CanvasCommandBatch,
  type CanvasItemRef,
  type CanvasProjection,
  type Frame,
  type ReviewStatus
} from "@crit/domain"
import {
  connectCanvasInput,
  type FrameInputIntent
} from "@crit/frame-bridge"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from "react"

import {
  applyCanvasCameraIntent,
  type CanvasCamera,
  canvasCameraStyle
} from "./canvas-camera.js"
import { useCanvasItemDrag } from "./canvas-item-drag.js"
import {
  CanvasSelection,
  type CanvasSelectionCommand
} from "./canvas-selection.js"
import {
  FrameRenderer,
  type FrameRepresentationResolver
} from "./frame-renderer.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"
import { framesById } from "./projection-index.js"
import { ReviewChrome } from "./review-chrome.js"
import type { ReviewClientEffect } from "./review-actions.js"
import { useReviewEffects } from "./review-effects.js"

interface CanvasBoardBaseProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly className?: string
}

type CanvasBoardReviewProps =
  | {
    readonly onSubmit: (commands: CanvasCommandBatch) => void
    readonly snapshotter: FrameSnapshotter
  }
  | {
    readonly onSubmit?: undefined
    readonly snapshotter?: undefined
  }

export type CanvasBoardProps = CanvasBoardBaseProps & CanvasBoardReviewProps

const ariaSelected = (
  selection: CanvasSelection,
  item: CanvasItemRef
): true | undefined =>
  CanvasSelection.has(selection, item) ? true : undefined

const itemStyle = (
  geometry: Frame["geometry"],
  zIndex: number
): CSSProperties => ({
  height: geometry.height,
  left: geometry.x,
  position: "absolute",
  top: geometry.y,
  width: geometry.width,
  zIndex
})

const isAdditiveSelection = (
  event: Pick<ReactPointerEvent, "ctrlKey" | "metaKey" | "shiftKey">
): boolean => event.ctrlKey || event.metaKey || event.shiftKey

const reviewStatusLabel = {
  "in-progress": "In progress",
  "ready-for-review": "Ready for review",
  approved: "Approved",
  "changes-requested": "Changes requested"
} satisfies Record<ReviewStatus, string>

export function CanvasBoard({
  camera,
  className,
  onCameraChange,
  onEffect,
  onSelectionChange,
  onSubmit,
  projection,
  resolver,
  selection,
  snapshotter
}: CanvasBoardProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null)
  const selectedFrameRef = useRef<HTMLDivElement>(null)
  const frameElementsRef = useRef(new Map<string, HTMLDivElement>())
  const navigationRef = useRef({ camera, onCameraChange })
  const selectionRef = useRef({ selection, onSelectionChange })
  const inputTarget = CanvasSelection.inputTarget(selection)
  const itemDrag = useCanvasItemDrag({
    camera,
    onSubmit
  })
  const reviewEffects = useReviewEffects({
    frameElementsRef,
    frames: projection.frames,
    onEffect,
    selectedFrameRef
  })

  useLayoutEffect(() => {
    navigationRef.current = { camera, onCameraChange }
  }, [camera, onCameraChange])

  useLayoutEffect(() => {
    selectionRef.current = { selection, onSelectionChange }
  }, [onSelectionChange, selection])

  useLayoutEffect(() => {
    selectedFrameRef.current = inputTarget._tag === "frame"
      ? frameElementsRef.current.get(inputTarget.frameId) ?? null
      : null
  }, [inputTarget])

  const applySelectionCommand = useCallback(
    (command: CanvasSelectionCommand) => {
      const latest = selectionRef.current
      latest.onSelectionChange(CanvasSelection.apply(latest.selection, command))
    },
    []
  )

  const applyCameraIntent = useCallback((intent: FrameInputIntent) => {
    const root = rootRef.current
    if (root === null) return
    const latest = navigationRef.current
    const nextCamera = applyCanvasCameraIntent(
      latest.camera,
      intent,
      root.getBoundingClientRect()
    )
    if (nextCamera !== latest.camera) {
      latest.onCameraChange(nextCamera)
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    return connectCanvasInput({
      target: window,
      root,
      onIntent: applyCameraIntent,
      ignore: ({ clientX, clientY }) => {
        const frame = selectedFrameRef.current
        if (frame === null) return false
        const rect = frame.getBoundingClientRect()
        return clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
      }
    })
  }, [applyCameraIntent])

  const frames = framesById(projection.frames)
  const selectFrame = (
    item: CanvasItemRef,
    event: ReactPointerEvent<HTMLDivElement>
  ) => applySelectionCommand({
    _tag: "item",
    item,
    additive: isAdditiveSelection(event)
  })

  const frameEntries = projection.stack.flatMap((item, zIndex) => {
    const frame = frames.get(item.frameId)
    if (frame === undefined) return []
    return [{ frame, item, zIndex }]
  })

  const items = frameEntries.length === 0
    ? (
      <p role="status">{`${projection.title} has no Frames.`}</p>
    )
    : frameEntries.map(({ frame, item, zIndex }) => {
      const { frameId } = item
      const frameReceivesInput = inputTarget._tag === "camera" ||
        inputTarget.frameId !== frameId
      const onFrameInputIntent = (intent: FrameInputIntent) => {
        if (intent.type === "select") {
          applySelectionCommand({
            _tag: "item",
            item,
            additive: intent.additive
          })
          return
        }
        applyCameraIntent(intent)
      }
      return (
        <div
          ref={(element) => {
            if (element === null) frameElementsRef.current.delete(frameId)
            else frameElementsRef.current.set(frameId, element)
          }}
          aria-label={frame.title}
          aria-selected={ariaSelected(selection, item)}
          data-frame-id={frameId}
          data-review-status={frame.status}
          key={frame.frameId}
          role="option"
          style={itemStyle(itemDrag.geometryFor(frame), zIndex)}
          onPointerDown={(event) => {
            selectFrame(item, event)
            itemDrag.begin(frame, "move", event)
          }}
        >
          {reviewStatusLabel[frame.status]}
          <FrameRenderer
            {...(frameReceivesInput ? { onInputIntent: onFrameInputIntent } : {})}
            frame={frame}
            paused={reviewEffects.isFramePaused(frameId)}
            resolver={resolver}
          />
          {CanvasSelection.has(selection, item) && onSubmit !== undefined
            ? (
              <span
                aria-label={`Resize ${frame.title}`}
                style={{
                  bottom: 0,
                  cursor: "se-resize",
                  position: "absolute",
                  right: 0
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  itemDrag.begin(frame, "resize", event)
                }}
              >
                Resize
              </span>
            )
            : null}
        </div>
      )
    })

  const hasItems = frameEntries.length > 0

  return (
    <section
      ref={rootRef}
      aria-label={projection.title}
      aria-multiselectable={hasItems ? true : undefined}
      className={className}
      role={hasItems ? "listbox" : undefined}
      style={{ position: "relative" }}
      onPointerCancel={itemDrag.cancel}
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('[role="option"]') !== null
        ) return
        applySelectionCommand({ _tag: "clear" })
      }}
      onPointerMove={itemDrag.update}
      onPointerUp={itemDrag.finish}
    >
      {onSubmit === undefined
        ? null
        : (
          <ReviewChrome
            fullscreen={reviewEffects.fullscreen}
            onEffect={reviewEffects.handle}
            onSubmit={onSubmit}
            projection={projection}
            selection={{ _tag: "items", items: selection }}
            snapshotter={snapshotter}
          />
        )}
      {hasItems
        ? <div style={canvasCameraStyle(camera)}>{items}</div>
        : items}
    </section>
  )
}
