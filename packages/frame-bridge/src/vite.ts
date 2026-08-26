import type { FrameBridgeOrigin } from "@crit/protocol"
import type { Plugin } from "vite"

import {
  FRAME_ROUTE_BRIDGE_HTML_MARKER,
  critFrameRouteBridgeScript
} from "./route.js"

export const frameRouteBridgeVitePlugin = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): Plugin => ({
  name: "crit-frame-route-bridge",
  transformIndexHtml(html) {
    if (html.includes(FRAME_ROUTE_BRIDGE_HTML_MARKER)) return
    return [{
      tag: "script",
      attrs: { [FRAME_ROUTE_BRIDGE_HTML_MARKER]: "" },
      children: critFrameRouteBridgeScript(input),
      injectTo: "head-prepend"
    }]
  }
})
