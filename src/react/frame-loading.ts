import { frameRelayUrl } from "../runtime/frame-relay.js"

export type FrameLoadingPolicy =
  | { readonly strategy: "navigate" }
  | { readonly strategy: "relay" }

export const DEFAULT_FRAME_LOADING_POLICY: FrameLoadingPolicy = {
  strategy: "navigate"
}

interface LoadableFrame {
  readonly id: string
  readonly url: string
  readonly snapshot?: unknown
}

const frameHash = (url: string) => {
  try {
    return new URL(url, "http://crit.local").hash
  } catch {
    return ""
  }
}

export const frameIframeUrl = (
  canvasId: string,
  frame: LoadableFrame,
  policy: FrameLoadingPolicy = DEFAULT_FRAME_LOADING_POLICY
) => frame.snapshot !== undefined || policy.strategy === "navigate"
  ? frame.url
  : frameRelayUrl(canvasId, frame.id, frameHash(frame.url))
