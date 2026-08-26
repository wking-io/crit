import type { FrameBridgeOrigin } from "@crit/protocol"
import { Option } from "effect"

import {
  FRAME_INPUT_BRIDGE_HTML_MARKER,
  critFrameInputBridgeScript,
  frameBridgeOriginFromHref
} from "./index.js"

export { FRAME_INPUT_BRIDGE_HTML_MARKER } from "./index.js"

export const parseFrameBridgeParentOrigin = (
  value: string | undefined
): FrameBridgeOrigin | undefined => {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if (url.username.length > 0 || url.password.length > 0) return undefined
  } catch {
    return undefined
  }
  return Option.getOrUndefined(frameBridgeOriginFromHref(value))
}

export const renderFrameInputBridgeTag = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): string =>
  `<script ${FRAME_INPUT_BRIDGE_HTML_MARKER}>${
    critFrameInputBridgeScript(input)
  }</script>`
