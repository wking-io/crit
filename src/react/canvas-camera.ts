import type { CanvasGeometry } from "../core/index.js"

export type CanvasCamera = {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export type CanvasPoint = {
  readonly x: number
  readonly y: number
}

export type CanvasWheelBehavior = "none" | "pan" | "zoom"

export interface CanvasCameraOptions {
  /** Multiplier applied to scroll-wheel and trackpad panning. */
  readonly panSpeed: number
  /** Multiplier applied to wheel and pinch zooming. */
  readonly zoomSpeed: number
  /** Ordered zoom levels used by shortcuts; the ends are the zoom bounds. */
  readonly zoomSteps: ReadonlyArray<number>
  /** Default behavior for an unmodified wheel event. */
  readonly wheelBehavior: CanvasWheelBehavior
}

export const DEFAULT_CANVAS_CAMERA_OPTIONS: CanvasCameraOptions = {
  panSpeed: 1,
  zoomSpeed: 1,
  zoomSteps: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
  wheelBehavior: "pan"
}

export type CanvasCameraState = {
  readonly camera: CanvasCamera
}

export type CanvasCameraInput =
  | {
      readonly type: "wheel"
      readonly clientX: number
      readonly clientY: number
      readonly ctrlKey: boolean
      readonly metaKey: boolean
      readonly deltaX: number
      readonly deltaY: number
      readonly origin: { readonly left: number; readonly top: number }
    }
  | {
      readonly type: "pinch"
      readonly scaleFactor: number
      readonly point: CanvasPoint
      readonly deltaX: number
      readonly deltaY: number
    }
  | {
      readonly type: "zoom-step"
      readonly direction: -1 | 0 | 1
      readonly viewport: { readonly width: number; readonly height: number }
    }
  | {
      readonly type: "pan"
      readonly deltaX: number
      readonly deltaY: number
    }
  | {
      readonly type: "fit"
      readonly geometries: ReadonlyArray<CanvasGeometry>
      readonly viewport: { readonly width: number; readonly height: number }
    }

export const initialCanvasCameraState = (
  camera: CanvasCamera = { x: 40, y: 40, zoom: 0.65 }
): CanvasCameraState => ({ camera })

const finitePositive = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback

const validZoomSteps = (steps: ReadonlyArray<number> | undefined) => {
  if (steps === undefined) return DEFAULT_CANVAS_CAMERA_OPTIONS.zoomSteps
  const valid = [
    ...new Set(steps.filter((step) => Number.isFinite(step) && step > 0))
  ].sort((left, right) => left - right)
  return valid.length > 1 ? valid : DEFAULT_CANVAS_CAMERA_OPTIONS.zoomSteps
}

const resolveOptions = (
  options: Partial<CanvasCameraOptions> | undefined
): CanvasCameraOptions => ({
  panSpeed: finitePositive(
    options?.panSpeed,
    DEFAULT_CANVAS_CAMERA_OPTIONS.panSpeed
  ),
  zoomSpeed: finitePositive(
    options?.zoomSpeed,
    DEFAULT_CANVAS_CAMERA_OPTIONS.zoomSpeed
  ),
  zoomSteps: validZoomSteps(options?.zoomSteps),
  wheelBehavior:
    options?.wheelBehavior === "none" ||
    options?.wheelBehavior === "pan" ||
    options?.wheelBehavior === "zoom"
      ? options.wheelBehavior
      : DEFAULT_CANVAS_CAMERA_OPTIONS.wheelBehavior
})

const clampZoom = (zoom: number, options: CanvasCameraOptions) =>
  Math.min(
    options.zoomSteps[options.zoomSteps.length - 1]!,
    Math.max(options.zoomSteps[0]!, zoom)
  )

const cameraAtPoint = (
  current: CanvasCamera,
  nextZoom: number,
  point: CanvasPoint
): CanvasCamera => {
  const worldX = (point.x - current.x) / current.zoom
  const worldY = (point.y - current.y) / current.zoom
  return {
    zoom: nextZoom,
    x: point.x - worldX * nextZoom,
    y: point.y - worldY * nextZoom
  }
}

const zoomStep = (
  zoom: number,
  direction: -1 | 1,
  steps: ReadonlyArray<number>
) => {
  if (direction === 1) {
    for (let index = 1; index < steps.length; index += 1) {
      const previous = steps[index - 1]!
      const next = steps[index]!
      if (next - zoom <= (next - previous) / 2) continue
      return next
    }
    return steps[steps.length - 1]!
  }
  for (let index = steps.length - 1; index > 0; index -= 1) {
    const previous = steps[index - 1]!
    const next = steps[index]!
    if (next - zoom >= (next - previous) / 2) continue
    return previous
  }
  return steps[0]!
}

const wheelBehavior = (
  configured: CanvasWheelBehavior,
  modified: boolean
): CanvasWheelBehavior => {
  if (!modified || configured === "none") return configured
  return configured === "pan" ? "zoom" : "pan"
}

const fitCamera = (
  geometries: ReadonlyArray<CanvasGeometry>,
  viewport: { readonly width: number; readonly height: number },
  options: CanvasCameraOptions
): CanvasCamera => {
  if (geometries.length === 0) return initialCanvasCameraState().camera
  const left = Math.min(...geometries.map((geometry) => geometry.x))
  const top = Math.min(...geometries.map((geometry) => geometry.y))
  const right = Math.max(
    ...geometries.map((geometry) => geometry.x + geometry.width)
  )
  const bottom = Math.max(
    ...geometries.map((geometry) => geometry.y + geometry.height)
  )
  const nextZoom = clampZoom(
    Math.min(
      1,
      (viewport.width - 80) / Math.max(1, right - left),
      (viewport.height - 80) / Math.max(1, bottom - top)
    ),
    options
  )
  return {
    zoom: nextZoom,
    x: (viewport.width - (right - left) * nextZoom) / 2 - left * nextZoom,
    y: (viewport.height - (bottom - top) * nextZoom) / 2 - top * nextZoom
  }
}

export const updateCanvasCamera = (
  state: CanvasCameraState,
  input: CanvasCameraInput,
  overrides?: Partial<CanvasCameraOptions>
): CanvasCameraState => {
  const options = resolveOptions(overrides)
  if (input.type === "pan") {
    return {
      camera: {
        ...state.camera,
        x: state.camera.x + input.deltaX,
        y: state.camera.y + input.deltaY
      }
    }
  }
  if (input.type === "fit") {
    return { camera: fitCamera(input.geometries, input.viewport, options) }
  }
  if (input.type === "zoom-step") {
    if (
      input.direction === 0 ||
      input.viewport.width <= 0 ||
      input.viewport.height <= 0
    ) return state
    return {
      camera: cameraAtPoint(
        state.camera,
        zoomStep(state.camera.zoom, input.direction, options.zoomSteps),
        { x: input.viewport.width / 2, y: input.viewport.height / 2 }
      )
    }
  }
  if (input.type === "pinch") {
    if (!Number.isFinite(input.scaleFactor) || input.scaleFactor <= 0) {
      return state
    }
    const nextZoom = clampZoom(
      state.camera.zoom * input.scaleFactor ** options.zoomSpeed,
      options
    )
    const anchored = cameraAtPoint(state.camera, nextZoom, input.point)
    const zoomRatio = nextZoom / state.camera.zoom
    return {
      camera: {
        ...anchored,
        x: anchored.x + input.deltaX * options.panSpeed * zoomRatio,
        y: anchored.y + input.deltaY * options.panSpeed * zoomRatio
      }
    }
  }

  const behavior = wheelBehavior(
    options.wheelBehavior,
    input.ctrlKey || input.metaKey
  )
  if (behavior === "none") return state
  if (behavior === "pan") {
    return {
      camera: {
        ...state.camera,
        x: state.camera.x -
          (Number.isFinite(input.deltaX) ? input.deltaX : 0) * options.panSpeed,
        y: state.camera.y -
          (Number.isFinite(input.deltaY) ? input.deltaY : 0) * options.panSpeed
      }
    }
  }
  const deltaY = Number.isFinite(input.deltaY) ? input.deltaY : 0
  const normalizedDelta = -Math.max(-10, Math.min(10, deltaY)) / 100
  const nextZoom = clampZoom(
    state.camera.zoom + normalizedDelta * options.zoomSpeed * state.camera.zoom,
    options
  )
  return {
    camera: cameraAtPoint(state.camera, nextZoom, {
      x: input.clientX - input.origin.left,
      y: input.clientY - input.origin.top
    })
  }
}

export const canvasUiScale = (zoom: number) =>
  1 / Math.max(DEFAULT_CANVAS_CAMERA_OPTIONS.zoomSteps[0]!, zoom)
