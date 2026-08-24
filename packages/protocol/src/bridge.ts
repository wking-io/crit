import { Result, Schema } from "effect"

const frameBridgeOriginFailure = (value: string) => {
  if (value === "null") return "A frame bridge origin cannot be the opaque null origin"
  const parsed = Schema.decodeUnknownResult(Schema.URLFromString)(value)
  if (Result.isFailure(parsed)) return "Expected an HTTP or HTTPS origin"
  const url = parsed.success
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Expected an HTTP or HTTPS origin"
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return "A frame bridge origin cannot contain credentials"
  }
  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    return "A frame bridge origin cannot contain a path, query, or fragment"
  }
  return `${url.protocol}//${url.host}` === value
    ? undefined
    : "A frame bridge origin must match event.origin serialization"
}

export const FrameBridgeOrigin = Schema.String.check(
  Schema.makeFilter<string>(frameBridgeOriginFailure)
).pipe(Schema.brand("FrameBridgeOrigin"))
export type FrameBridgeOrigin = typeof FrameBridgeOrigin.Type

export const FRAME_INPUT_BRIDGE_SOURCE = "@crit/frame-bridge/input"
export const FRAME_INPUT_BRIDGE_SCHEMA_VERSION = 1 as const

export const FrameInputIntentSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("select"),
    additive: Schema.Boolean
  }),
  Schema.Struct({ type: Schema.Literal("delete") }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    tool: Schema.Literals(["select", "pan"])
  }),
  Schema.Struct({
    type: Schema.Literal("zoom-step"),
    direction: Schema.Literals([-1, 1])
  }),
  Schema.Struct({
    type: Schema.Literal("wheel"),
    clientX: Schema.Finite,
    clientY: Schema.Finite,
    ctrlKey: Schema.Boolean,
    metaKey: Schema.Boolean,
    deltaX: Schema.Finite,
    deltaY: Schema.Finite
  }),
  Schema.Struct({
    type: Schema.Literal("pinch"),
    clientX: Schema.Finite,
    clientY: Schema.Finite,
    deltaX: Schema.Finite,
    deltaY: Schema.Finite,
    scaleFactor: Schema.Finite.check(Schema.isGreaterThan(0))
  })
])
export type FrameInputIntent = typeof FrameInputIntentSchema.Type

export const FrameInputBridgeMessageSchema = Schema.Struct({
  source: Schema.Literal(FRAME_INPUT_BRIDGE_SOURCE),
  schemaVersion: Schema.Literal(FRAME_INPUT_BRIDGE_SCHEMA_VERSION),
  intent: FrameInputIntentSchema
})
export type FrameInputBridgeMessage = typeof FrameInputBridgeMessageSchema.Type

export const decodeFrameInputBridgeMessage = Schema.decodeUnknownOption(
  FrameInputBridgeMessageSchema,
  { onExcessProperty: "error" }
)
