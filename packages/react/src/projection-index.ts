import type { CanvasProjection, Frame } from "@crit/domain"

type Frames = CanvasProjection["frames"]

const frames = new WeakMap<Frames, ReadonlyMap<Frame["frameId"], Frame>>()

export const framesById = (values: Frames): ReadonlyMap<Frame["frameId"], Frame> => {
  const cached = frames.get(values)
  if (cached !== undefined) return cached
  const next = new Map(values.map((frame) => [frame.frameId, frame]))
  frames.set(values, next)
  return next
}
