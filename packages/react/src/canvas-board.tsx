import {
  type CanvasCommandBatch,
  type CanvasItemRef,
  type CanvasProjection,
  type Frame
} from "@crit/domain"
import {
  connectCanvasInput,
  type FrameInputIntent
} from "@crit/frame-bridge"
import {
  LazyMotion,
  MotionConfig,
  domAnimation
} from "motion/react"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from "react"

import {
  applyCanvasCameraIntent,
  fitCameraToBox,
  fitCameraToFrames,
  CanvasCamera
} from "./canvas-camera.js"
import {
  applyCanvasPlaneCamera,
  camerasEqual,
  canvasCameraStyle
} from "./canvas-camera-presentation.js"
import { CritContextMenuDismissalScope } from "./canvas-context-menu.js"
import { useCanvasClipboard } from "./canvas-clipboard.js"
import { useCanvasItemDrag } from "./canvas-item-drag.js"
import { CanvasGroupSelection } from "./canvas-group-selection.js"
import {
  applyMarqueeBox,
  MARQUEE_DRAG_THRESHOLD,
  screenToWorldPoint,
  selectionBoxBetween,
  selectionInWorldBox
} from "./canvas-selection-marquee.js"
import {
  CanvasSelectionStoreProvider,
  createCanvasSelectionStore
} from "./canvas-selection-store.js"
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
import { frameMountQueueFor } from "./frame-mount-queue.js"
import type { FrameSnapshotter } from "./frame-snapshot.js"
import { framesById } from "./projection-index.js"
import { GlyphProvider } from "./glyph.js"
import { CritOverlayProvider } from "./overlay-container.js"
import { shortIdForIndex } from "./frame-status-chrome.js"
import { ReviewCanvasSurface } from "./review-canvas-surface.js"
import { ReviewChrome } from "./review-chrome.js"
import { ReviewFrame, canvasUiScale } from "./review-frame.js"
import {
  ReviewClientEffect,
  ReviewSelection,
  type ReviewClientEffect as ReviewClientEffectValue
} from "./review-actions.js"
import { useReviewEffects } from "./review-effects.js"
import { ReviewRunnerProvider } from "./review-runner.js"

interface CanvasBoardBaseProps {
  readonly projection: CanvasProjection
  readonly resolver: FrameRepresentationResolver
  readonly camera: CanvasCamera
  readonly onCameraChange: (camera: CanvasCamera) => void
  readonly selection: CanvasSelection
  readonly onSelectionChange: (selection: CanvasSelection) => void
  readonly onEffect?: ((effect: ReviewClientEffectValue) => void) | undefined
  readonly mutable?: boolean
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

const boardClassName = (className: string | undefined): string =>
  className === undefined ? "crit-canvas" : `crit-canvas ${className}`

const isAdditiveSelection = (
  event: Pick<ReactPointerEvent, "ctrlKey" | "metaKey" | "shiftKey">
): boolean => event.ctrlKey || event.metaKey || event.shiftKey

export const CanvasBoard = memo(function CanvasBoard({
  camera,
  className,
  mutable,
  onCameraChange,
  onEffect,
  onSelectionChange,
  onSubmit,
  projection,
  resolver,
  selection,
  snapshotter
}: CanvasBoardProps): ReactElement {
  const allowsMutation = mutable ?? onSubmit !== undefined
  const rootRef = useRef<HTMLElement>(null)
  const planeRef = useRef<HTMLDivElement>(null)
  const selectedFrameRef = useRef<HTMLDivElement>(null)
  const canvasCaptureRef = useRef(false)
  const [canvasCapture, setCanvasCapture] = useState(false)
  const frameElementsRef = useRef(new Map<string, HTMLDivElement>())
  const cameraRef = useRef(camera)
  const lastNotifiedCameraRef = useRef(camera)
  const persistCameraTimeoutRef = useRef(0)
  const onCameraChangeRef = useRef(onCameraChange)
  onCameraChangeRef.current = onCameraChange
  const [zoom, setZoom] = useState(camera.zoom)
  const [selectionStore] = useState(() => createCanvasSelectionStore(selection))
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const lastPropSelectionRef = useRef(selection)
  const lastPropCameraRef = useRef(camera)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const zoomMarqueeReadyRef = useRef(false)
  const groupSelectionRef = useRef<HTMLDivElement>(null)

  const commitCamera = useCallback((next: CanvasCamera) => {
    const previousZoom = cameraRef.current.zoom
    const root = rootRef.current
    if (root !== null) frameMountQueueFor(root).postpone()
    cameraRef.current = next
    const plane = planeRef.current
    if (plane !== null) applyCanvasPlaneCamera(plane, next)
    if (next.zoom !== previousZoom) setZoom(next.zoom)
    window.clearTimeout(persistCameraTimeoutRef.current)
    persistCameraTimeoutRef.current = window.setTimeout(() => {
      lastNotifiedCameraRef.current = cameraRef.current
      onCameraChangeRef.current(cameraRef.current)
    }, 120)
  }, [])

  useLayoutEffect(() => {
    if (camerasEqual(camera, lastPropCameraRef.current)) return
    lastPropCameraRef.current = camera
    cameraRef.current = camera
    lastNotifiedCameraRef.current = camera
    const plane = planeRef.current
    if (plane !== null) applyCanvasPlaneCamera(plane, camera)
    if (camera.zoom !== zoom) setZoom(camera.zoom)
  }, [camera, zoom])

  useLayoutEffect(() => {
    if (CanvasSelection.equal(selection, lastPropSelectionRef.current)) return
    lastPropSelectionRef.current = selection
    selectionStore.set(selection)
  }, [selection, selectionStore])

  useEffect(() => () => {
    window.clearTimeout(persistCameraTimeoutRef.current)
    if (!camerasEqual(cameraRef.current, lastNotifiedCameraRef.current)) {
      onCameraChangeRef.current(cameraRef.current)
    }
  }, [])

  useEffect(() => {
    const setReady = (ready: boolean) => {
      zoomMarqueeReadyRef.current = ready
      const root = rootRef.current
      if (root === null) return
      if (ready) root.dataset.zoomMarqueeReady = ""
      else delete root.dataset.zoomMarqueeReady
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      setReady(true)
      if (event.metaKey || event.ctrlKey) event.preventDefault()
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") setReady(false)
    }
    const blur = () => setReady(false)
    window.addEventListener("keydown", keydown, true)
    window.addEventListener("keyup", keyup, true)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", keydown, true)
      window.removeEventListener("keyup", keyup, true)
      window.removeEventListener("blur", blur)
    }
  }, [])

  const itemDrag = useCanvasItemDrag(
    onSubmit === undefined
      ? {
        frames: projection.frames,
        getFrameElement: (frameId) => frameElementsRef.current.get(frameId),
        getGroupSelectionElement: () => groupSelectionRef.current,
        getSelectedFrameIds: () => new Set(
          selectionStore.get().map((item) => item.frameId)
        ),
        getZoom: () => cameraRef.current.zoom
      }
      : {
        frames: projection.frames,
        getFrameElement: (frameId) => frameElementsRef.current.get(frameId),
        getGroupSelectionElement: () => groupSelectionRef.current,
        getSelectedFrameIds: () => new Set(
          selectionStore.get().map((item) => item.frameId)
        ),
        getZoom: () => cameraRef.current.zoom,
        onSubmit
      }
  )
  const zoomToFit = useCallback(() => {
    const root = rootRef.current
    if (root === null) return
    const viewport = root.getBoundingClientRect()
    commitCamera(fitCameraToFrames(
      projection.frames.map((frame) => frame.geometry),
      { width: viewport.width, height: viewport.height }
    ))
  }, [commitCamera, projection.frames])
  const reviewEffectOptions = onEffect === undefined
    ? {
      selectedFrameRef,
      zoomToFit
    }
    : {
      onEffect,
      selectedFrameRef,
      zoomToFit
    }
  const reviewEffects = useReviewEffects(reviewEffectOptions)
  const handleEffect = useCallback((effect: ReviewClientEffectValue) => {
    if (ReviewClientEffect.$is("zoomToFit")(effect)) zoomToFit()
    reviewEffects.handle(effect)
  }, [reviewEffects, zoomToFit])

  const syncSelectedFrame = useCallback(() => {
    const target = CanvasSelection.inputTarget(selectionStore.get())
    selectedFrameRef.current = CanvasInputTarget.$is("frame")(target)
      ? frameElementsRef.current.get(target.frameId) ?? null
      : null
  }, [selectionStore])

  useLayoutEffect(() => {
    syncSelectedFrame()
    return selectionStore.subscribe(syncSelectedFrame)
  }, [selectionStore, syncSelectedFrame])

  const commitSelection = useCallback((next: CanvasSelection) => {
    selectionStore.set(next)
    onSelectionChangeRef.current(next)
  }, [selectionStore])

  useCanvasClipboard({
    rootRef,
    frames: projection.frames,
    selectionStore,
    onSubmit: allowsMutation ? onSubmit : undefined,
    onSelectionChange: commitSelection
  })

  const applySelectionCommand = useCallback(
    (command: CanvasSelectionCommandValue) => {
      commitSelection(CanvasSelection.apply(selectionStore.get(), command))
    },
    [commitSelection, selectionStore]
  )

  const applyCameraIntent = useCallback((intent: FrameInputIntent) => {
    if (intent.type === "clear-selection") {
      if (reviewEffects.fullscreenFrameId !== null) {
        reviewEffects.handle(ReviewClientEffect.fullscreen({ target: "exit" }))
      } else {
        applySelectionCommand(CanvasSelectionCommand.clear())
      }
      rootRef.current?.focus({ preventScroll: true })
      return
    }
    if (intent.type === "tool") {
      const capture = intent.tool === "pan"
      canvasCaptureRef.current = capture
      setCanvasCapture(capture)
      rootRef.current?.focus({ preventScroll: true })
      return
    }
    const root = rootRef.current
    if (root === null) return
    const nextCamera = applyCanvasCameraIntent(
      cameraRef.current,
      intent,
      root.getBoundingClientRect()
    )
    if (nextCamera !== cameraRef.current) commitCamera(nextCamera)
  }, [applySelectionCommand, commitCamera, reviewEffects])

  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    return connectCanvasInput({
      target: window,
      root,
      onIntent: applyCameraIntent,
      ignore: ({ clientX, clientY }) => {
        if (canvasCaptureRef.current) return false
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
  ) => {
    const additive = isAdditiveSelection(event)
    const current = selectionStore.get()
    if (!additive && CanvasSelection.has(current, item) && current.length > 1) return
    applySelectionCommand(CanvasSelectionCommand.item({ item, additive }))
  }

  const startMarquee = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const root = rootRef.current
    const marquee = marqueeRef.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    const start = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
    const additive = isAdditiveSelection(event)
    const initial = additive
      ? selectionStore.get()
      : CanvasSelection.make([])
    if (!additive) selectionStore.set(initial)
    const startCamera = cameraRef.current
    const targets = projection.frames.map((frame) => ({
      item: { _tag: "frame" as const, frameId: frame.frameId },
      geometry: itemDrag.geometryFor(frame)
    }))
    let dragged = false
    const move = (next: PointerEvent) => {
      const current = {
        x: next.clientX - rect.left,
        y: next.clientY - rect.top
      }
      if (
        !dragged &&
        Math.hypot(current.x - start.x, current.y - start.y) <
          MARQUEE_DRAG_THRESHOLD
      ) return
      dragged = true
      const screenBox = selectionBoxBetween(start, current)
      if (marquee !== null) applyMarqueeBox(marquee, screenBox)
      selectionStore.set(selectionInWorldBox(
        targets,
        selectionBoxBetween(
          screenToWorldPoint(start, startCamera),
          screenToWorldPoint(current, startCamera)
        ),
        initial
      ))
    }
    const end = () => {
      if (marquee !== null) applyMarqueeBox(marquee, null)
      onSelectionChangeRef.current(selectionStore.get())
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }

  const startPan = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY }
    const camera = cameraRef.current
    const move = (next: PointerEvent) => commitCamera(CanvasCamera.make({
      x: camera.x + next.clientX - start.x,
      y: camera.y + next.clientY - start.y,
      zoom: camera.zoom
    }))
    const end = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }

  const startZoomMarquee = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const root = rootRef.current
    const marquee = marqueeRef.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    const start = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }
    const startCamera = cameraRef.current
    let current = start
    const move = (next: PointerEvent) => {
      current = {
        x: next.clientX - rect.left,
        y: next.clientY - rect.top
      }
      if (marquee !== null) applyMarqueeBox(
        marquee,
        selectionBoxBetween(start, current)
      )
    }
    const cleanup = () => {
      if (marquee !== null) applyMarqueeBox(marquee, null)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
    }
    const finish = () => {
      cleanup()
      const worldBox = selectionBoxBetween(
        screenToWorldPoint(start, startCamera),
        screenToWorldPoint(current, startCamera)
      )
      commitCamera(fitCameraToBox(worldBox, {
        width: rect.width,
        height: rect.height
      }))
    }
    const cancel = () => cleanup()
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
  }

  const frameEntries = projection.stack.flatMap((item, zIndex) => {
    const frame = frames.get(item.frameId)
    if (frame === undefined) return []
    return [{ frame, item, zIndex }]
  })
  const fullscreenGeometry = (frameId: Frame["frameId"]): Frame["geometry"] | undefined => {
    if (reviewEffects.fullscreenFrameId !== frameId) return undefined
    const root = rootRef.current
    if (root === null) return undefined
    const camera = cameraRef.current
    return {
      x: -camera.x / camera.zoom,
      y: -camera.y / camera.zoom,
      width: root.clientWidth / camera.zoom,
      height: root.clientHeight / camera.zoom
    }
  }

  const items = frameEntries.length === 0
    ? (
      <p className="crit-message" role="status">{`${projection.title} has no Frames.`}</p>
    )
    : frameEntries.map(({ frame, item, zIndex }) => {
      const { frameId } = item
      const expandedGeometry = fullscreenGeometry(frameId)
      return (
        <ReviewFrame
          frame={frame}
          frameRef={(element) => {
            if (element === null) frameElementsRef.current.delete(frameId)
            else frameElementsRef.current.set(frameId, element)
          }}
          geometry={itemDrag.geometryFor(frame)}
          fullscreenGeometry={expandedGeometry}
          key={frame.frameId}
          shortId={shortIdForIndex(zIndex)}
          topZIndex={Math.max(0, frameEntries.length - 1)}
          uiScale={canvasUiScale(zoom)}
          zIndex={zIndex}
          onMove={(event) => {
            if (!allowsMutation || expandedGeometry !== undefined) return
            itemDrag.begin(frame, "move", event)
          }}
          onResize={!allowsMutation
            ? undefined
            : (event, handle) => itemDrag.begin(frame, "resize", event, handle)}
          onSelect={(event) => selectFrame(item, event)}
          onTarget={() => applySelectionCommand(CanvasSelectionCommand.item({
            item,
            additive: false
          }))}
        >
          <FrameRenderer
            frame={frame}
            onInputIntent={applyCameraIntent}
            resolver={resolver}
          />
        </ReviewFrame>
      )
    })

  const hasItems = frameEntries.length > 0

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      data-canvas-capture={canvasCapture || undefined}
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
      onPointerDownCapture={(event) => {
        if (canvasCaptureRef.current) {
          const target = event.target
          if (target instanceof Element && target.closest(".crit-toolbar, [role='menu'], [role='dialog'], button") !== null) return
          startPan(event)
          return
        }
        if (
          !zoomMarqueeReadyRef.current ||
          (!event.metaKey && !event.ctrlKey)
        ) return
        const target = event.target
        if (
          target instanceof Element &&
          target.closest(".crit-toolbar, [role='menu'], [role='dialog']") !== null
        ) return
        event.stopPropagation()
        startZoomMarquee(event)
      }}
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('[role="option"]') !== null
        ) return
        startMarquee(event)
      }}
      onPointerMove={itemDrag.update}
      onPointerUp={itemDrag.finish}
    >
      <style data-crit-styles="">{critStyles}</style>
      {canvasCapture ? (
        <button
          type="button"
          className="crit-canvas__navigation-mode"
          onClick={() => applyCameraIntent({ type: "tool", tool: "select" })}
        >Canvas navigation · V to interact</button>
      ) : null}
      <GlyphProvider>
        <CritOverlayProvider>
          <CanvasSelectionStoreProvider store={selectionStore}>
            <MotionConfig reducedMotion="user">
              <LazyMotion features={domAnimation} strict>
                {onSubmit === undefined
                  ? (
                    hasItems
                      ? (
                        <div
                          className="crit-canvas__plane"
                          ref={planeRef}
                          style={canvasCameraStyle(cameraRef.current)}
                        >
                          {items}
                        </div>
                      )
                      : items
                  )
                  : (
                    <ReviewRunnerProvider
                      fullscreen={reviewEffects.fullscreen}
                      getSelection={() =>
                        ReviewSelection.items({ items: selectionStore.get() })}
                      onEffect={handleEffect}
                      onSubmit={onSubmit}
                      projection={projection}
                      snapshotter={snapshotter}
                    >
                      <CritContextMenuDismissalScope signal={zoom}>
                        {allowsMutation
                          ? (
                            <ReviewChrome
                              fullscreen={reviewEffects.fullscreen}
                              onEffect={handleEffect}
                              onSubmit={onSubmit}
                              projection={projection}
                              selection={ReviewSelection.items({
                                items: selectionStore.get()
                              })}
                              snapshotter={snapshotter}
                            />
                          )
                          : null}
                        <ReviewCanvasSurface cameraRef={cameraRef} rootRef={rootRef}>
                          {hasItems
                            ? (
                              <div
                                className="crit-canvas__plane"
                                ref={planeRef}
                                style={canvasCameraStyle(cameraRef.current)}
                              >
                                <CanvasGroupSelection
                                  allowsMutation={allowsMutation}
                                  frames={projection.frames}
                                  geometryFor={itemDrag.geometryFor}
                                  groupRef={(element) => {
                                    groupSelectionRef.current = element
                                  }}
                                  onMove={(frame, event) => {
                                    itemDrag.begin(frame, "move", event)
                                  }}
                                  onResize={itemDrag.beginGroupResize}
                                  uiScale={canvasUiScale(zoom)}
                                />
                                {items}
                              </div>
                            )
                            : <div className="crit-canvas__surface">{items}</div>}
                        </ReviewCanvasSurface>
                      </CritContextMenuDismissalScope>
                    </ReviewRunnerProvider>
                  )}
              </LazyMotion>
            </MotionConfig>
          </CanvasSelectionStoreProvider>
        </CritOverlayProvider>
      </GlyphProvider>
      <div
        aria-hidden
        className="crit-canvas__selection-marquee"
        hidden
        ref={marqueeRef}
      />
    </section>
  )
})
