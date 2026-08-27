import {
  type CanvasCommandBatch,
  type CanvasItemRef,
  type CanvasProjection
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
  CanvasInputTarget,
  CanvasSelection,
  CanvasSelectionCommand,
  type CanvasSelectionCommand as CanvasSelectionCommandValue
} from "./canvas-selection.js"
import { critStyles } from "./crit-styles.js"
import {
  FrameRenderer,
  type FrameRepresentationResolver
} from "./frame-renderer.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"
import { framesById } from "./projection-index.js"
import { GlyphProvider } from "./glyph.js"
import { CritOverlayProvider } from "./overlay-container.js"
import { shortIdForIndex } from "./frame-status-chrome.js"
import { ReviewChrome } from "./review-chrome.js"
import { ReviewFrame, canvasUiScale } from "./review-frame.js"
import { ReviewSelection, type ReviewClientEffect } from "./review-actions.js"
import { useReviewEffects } from "./review-effects.js"
import { ReviewRunnerProvider } from "./review-runner.js"

interface CanvasBoardBaseProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly onEffect?: ((effect: ReviewClientEffect) => void) | undefined
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

const boardClassName = (className: string | undefined): string =>
  className === undefined ? "crit-canvas" : `crit-canvas ${className}`

const isAdditiveSelection = (
  event: Pick<ReactPointerEvent, "ctrlKey" | "metaKey" | "shiftKey">
): boolean => event.ctrlKey || event.metaKey || event.shiftKey

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
  const itemDragOptions = onSubmit === undefined
    ? { camera }
    : { camera, onSubmit }
  const itemDrag = useCanvasItemDrag(itemDragOptions)
  const reviewEffectOptions = onEffect === undefined
    ? { frameElementsRef, frames: projection.frames, selectedFrameRef }
    : { frameElementsRef, frames: projection.frames, onEffect, selectedFrameRef }
  const reviewEffects = useReviewEffects(reviewEffectOptions)

  useLayoutEffect(() => {
    navigationRef.current = { camera, onCameraChange }
  }, [camera, onCameraChange])

  useLayoutEffect(() => {
    selectionRef.current = { selection, onSelectionChange }
  }, [onSelectionChange, selection])

  useLayoutEffect(() => {
    selectedFrameRef.current = CanvasInputTarget.$is("frame")(inputTarget)
      ? frameElementsRef.current.get(inputTarget.frameId) ?? null
      : null
  }, [inputTarget])

  const applySelectionCommand = useCallback(
    (command: CanvasSelectionCommandValue) => {
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
  ) => applySelectionCommand(CanvasSelectionCommand.item({
    item,
    additive: isAdditiveSelection(event)
  }))

  const frameEntries = projection.stack.flatMap((item, zIndex) => {
    const frame = frames.get(item.frameId)
    if (frame === undefined) return []
    return [{ frame, item, zIndex }]
  })

  const items = frameEntries.length === 0
    ? (
      <p className="crit-message" role="status">{`${projection.title} has no Frames.`}</p>
    )
    : frameEntries.map(({ frame, item, zIndex }) => {
      const { frameId } = item
      const frameIsInputTarget = CanvasInputTarget.$is("frame")(inputTarget) &&
        inputTarget.frameId === frameId
      return (
        <ReviewFrame
          capture={!frameIsInputTarget}
          frame={frame}
          frameRef={(element) => {
            if (element === null) frameElementsRef.current.delete(frameId)
            else frameElementsRef.current.set(frameId, element)
          }}
          geometry={itemDrag.geometryFor(frame)}
          key={frame.frameId}
          selected={CanvasSelection.has(selection, item)}
          selectedLabel={ariaSelected(selection, item)}
          shortId={shortIdForIndex(zIndex)}
          topZIndex={Math.max(0, frameEntries.length - 1)}
          uiScale={canvasUiScale(camera.zoom)}
          zIndex={zIndex}
          onMove={(event) => itemDrag.begin(frame, "move", event)}
          onResize={onSubmit === undefined
            ? undefined
            : (event, handle) => itemDrag.begin(frame, "resize", event, handle)}
          onSelect={(event) => selectFrame(item, event)}
        >
          <FrameRenderer
            frame={frame}
            paused={reviewEffects.isFramePaused(frameId)}
            resolver={resolver}
          />
        </ReviewFrame>
      )
    })

  const hasItems = frameEntries.length > 0

  return (
    <section
      ref={rootRef}
      aria-label={projection.title}
      aria-multiselectable={hasItems ? true : undefined}
      className={boardClassName(className)}
      role={hasItems ? "listbox" : undefined}
      style={{
        height: "100%",
        minHeight: 420,
        overflow: "clip",
        position: "relative",
        width: "100%"
      }}
      onPointerCancel={itemDrag.cancel}
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('[role="option"]') !== null
        ) return
        applySelectionCommand(CanvasSelectionCommand.clear())
      }}
      onPointerMove={itemDrag.update}
      onPointerUp={itemDrag.finish}
    >
      <style data-crit-styles="">{critStyles}</style>
      <GlyphProvider>
        <CritOverlayProvider>
          {onSubmit === undefined
            ? (
              hasItems
                ? (
                  <div className="crit-canvas__plane" style={canvasCameraStyle(camera)}>
                    {items}
                  </div>
                )
                : items
            )
            : (
              <ReviewRunnerProvider
                fullscreen={reviewEffects.fullscreen}
                onEffect={reviewEffects.handle}
                onSubmit={onSubmit}
                projection={projection}
                selection={ReviewSelection.items({ items: selection })}
                snapshotter={snapshotter}
              >
                <ReviewChrome
                  fullscreen={reviewEffects.fullscreen}
                  onEffect={reviewEffects.handle}
                  onSubmit={onSubmit}
                  projection={projection}
                  selection={ReviewSelection.items({ items: selection })}
                  snapshotter={snapshotter}
                />
                {hasItems
                  ? (
                    <div className="crit-canvas__plane" style={canvasCameraStyle(camera)}>
                      {items}
                    </div>
                  )
                  : items}
              </ReviewRunnerProvider>
            )}
        </CritOverlayProvider>
      </GlyphProvider>
    </section>
  )
}
