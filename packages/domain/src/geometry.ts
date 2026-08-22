import { Schema } from "effect"

const finite = Schema.Number.check(Schema.isFinite())
const positive = finite.check(Schema.isGreaterThan(0))

export const Point = Schema.Struct({ x: finite, y: finite })
export type Point = typeof Point.Type

export const Geometry = Schema.Struct({
  x: finite,
  y: finite,
  width: positive,
  height: positive
})
export type Geometry = typeof Geometry.Type

export const NormalizedPoint = Schema.Struct({
  x: finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  y: finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
})
export type NormalizedPoint = typeof NormalizedPoint.Type
