export type ZoomCamera = {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export type ZoomPoint = {
  readonly x: number
  readonly y: number
}

export interface ZoomPhysicsSettings {
  /** Log-zoom velocity added per wheel delta unit. */
  readonly wheelSensitivity: number
  /** Log-zoom velocity added per log unit of native pinch scale. */
  readonly pinchSensitivity: number
  /** Log-zoom velocity added by a keyboard zoom shortcut. */
  readonly shortcutImpulse: number
  /** Exponential velocity decay, in inverse seconds. */
  readonly decay: number
  /** Maximum absolute log-zoom velocity. */
  readonly maximumSpeed: number
  /** Velocity below which the animation comes to rest. */
  readonly stopSpeed: number
}

export const DEFAULT_ZOOM_PHYSICS_SETTINGS: ZoomPhysicsSettings = {
  wheelSensitivity: 0.018,
  pinchSensitivity: 8,
  shortcutImpulse: 1.5,
  decay: 8,
  maximumSpeed: 4,
  stopSpeed: 0.01
}

export const MINIMUM_CANVAS_ZOOM = 0.1
export const MAXIMUM_CANVAS_ZOOM = 2

const finitePositive = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback

export const resolveZoomPhysicsSettings = (
  settings: Partial<ZoomPhysicsSettings> | undefined
): ZoomPhysicsSettings => ({
  wheelSensitivity: finitePositive(
    settings?.wheelSensitivity,
    DEFAULT_ZOOM_PHYSICS_SETTINGS.wheelSensitivity
  ),
  pinchSensitivity: finitePositive(
    settings?.pinchSensitivity,
    DEFAULT_ZOOM_PHYSICS_SETTINGS.pinchSensitivity
  ),
  shortcutImpulse: finitePositive(
    settings?.shortcutImpulse,
    DEFAULT_ZOOM_PHYSICS_SETTINGS.shortcutImpulse
  ),
  decay: finitePositive(settings?.decay, DEFAULT_ZOOM_PHYSICS_SETTINGS.decay),
  maximumSpeed: finitePositive(
    settings?.maximumSpeed,
    DEFAULT_ZOOM_PHYSICS_SETTINGS.maximumSpeed
  ),
  stopSpeed: finitePositive(
    settings?.stopSpeed,
    DEFAULT_ZOOM_PHYSICS_SETTINGS.stopSpeed
  )
})

export const clampZoomVelocity = (
  velocity: number,
  settings: ZoomPhysicsSettings
) => Math.min(settings.maximumSpeed, Math.max(-settings.maximumSpeed, velocity))

export const wheelZoomImpulse = (
  deltaY: number,
  settings: ZoomPhysicsSettings
) => Number.isFinite(deltaY) ? -deltaY * settings.wheelSensitivity : 0

export const pinchZoomImpulse = (
  scaleFactor: number,
  settings: ZoomPhysicsSettings
) => Number.isFinite(scaleFactor) && scaleFactor > 0
  ? Math.log(scaleFactor) * settings.pinchSensitivity
  : 0

export const shortcutZoomImpulse = (
  direction: -1 | 0 | 1,
  settings: ZoomPhysicsSettings
) => direction * settings.shortcutImpulse

const cameraAtPoint = (
  current: ZoomCamera,
  nextZoom: number,
  point: ZoomPoint
): ZoomCamera => {
  const worldX = (point.x - current.x) / current.zoom
  const worldY = (point.y - current.y) / current.zoom
  return {
    zoom: nextZoom,
    x: point.x - worldX * nextZoom,
    y: point.y - worldY * nextZoom
  }
}

export type ZoomPhysicsStep = {
  readonly camera: ZoomCamera
  readonly velocity: number
}

/**
 * Advances inertial zoom using the exact integral of exponential velocity
 * decay. The result is stable across display refresh rates.
 */
export const stepZoomPhysics = (
  camera: ZoomCamera,
  velocity: number,
  elapsedMilliseconds: number,
  point: ZoomPoint,
  settings: ZoomPhysicsSettings
): ZoomPhysicsStep => {
  if (
    !Number.isFinite(velocity) ||
    velocity === 0 ||
    !Number.isFinite(elapsedMilliseconds) ||
    elapsedMilliseconds <= 0
  ) {
    return { camera, velocity: 0 }
  }

  // Avoid a large jump when a backgrounded tab resumes.
  const elapsedSeconds = Math.min(elapsedMilliseconds / 1_000, 0.05)
  const decayFactor = Math.exp(-settings.decay * elapsedSeconds)
  const logZoomDelta = velocity * (1 - decayFactor) / settings.decay
  const unclampedZoom = camera.zoom * Math.exp(logZoomDelta)
  const nextZoom = Math.min(
    MAXIMUM_CANVAS_ZOOM,
    Math.max(MINIMUM_CANVAS_ZOOM, unclampedZoom)
  )
  const hitBoundary =
    (nextZoom === MAXIMUM_CANVAS_ZOOM && velocity > 0) ||
    (nextZoom === MINIMUM_CANVAS_ZOOM && velocity < 0)
  const decayedVelocity = velocity * decayFactor
  const nextVelocity = hitBoundary || Math.abs(decayedVelocity) < settings.stopSpeed
    ? 0
    : decayedVelocity

  return {
    camera: cameraAtPoint(camera, nextZoom, point),
    velocity: nextVelocity
  }
}
