import type { Plugin } from "vite"

import { FRAME_INPUT_BRIDGE_HTML_MARKER } from "./html.js"
import { critFrameInputBridgeScript, type FrameBridgeOrigin } from "./index.js"

export const frameInputBridgeVitePlugin = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): Plugin => ({
  name: "crit-frame-input-bridge",
  transformIndexHtml(html) {
    if (html.includes(FRAME_INPUT_BRIDGE_HTML_MARKER)) return
    return [{
      tag: "script",
      attrs: { [FRAME_INPUT_BRIDGE_HTML_MARKER]: "" },
      children: critFrameInputBridgeScript(input),
      injectTo: "head-prepend"
    }]
  }
})
