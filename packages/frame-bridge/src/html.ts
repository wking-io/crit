import { FrameBridgeOrigin } from "@crit/protocol"
import { Option, Schema } from "effect"

import {
  FRAME_ROUTE_BRIDGE_HTML_MARKER,
  critFrameRouteBridgeScript
} from "./route.js"

export { FRAME_ROUTE_BRIDGE_HTML_MARKER } from "./route.js"

export const parseFrameBridgeParentOrigin = (
  value: string | undefined
): FrameBridgeOrigin | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(FrameBridgeOrigin)(value))

export const renderFrameRouteBridgeTag = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): string =>
  `<script ${FRAME_ROUTE_BRIDGE_HTML_MARKER}="">${
    critFrameRouteBridgeScript(input)
  }</script>`
