import { Schema } from "effect"

export const FRAME_INPUT_BRIDGE_SOURCE = "@crit/frame-bridge/input"

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
  schemaVersion: Schema.Literal(1),
  intent: FrameInputIntentSchema
})
export type FrameInputBridgeMessage = typeof FrameInputBridgeMessageSchema.Type
