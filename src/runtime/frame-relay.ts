export const CRIT_FRAME_RELAY_PATH = "/__crit/frames/"

export interface FrameRelayRoute {
  readonly canvasId: string
  readonly frameId: string
}

export const frameRelayUrl = (
  canvasId: string,
  frameId: string,
  hash = ""
) => `${CRIT_FRAME_RELAY_PATH}${encodeURIComponent(canvasId)}/${encodeURIComponent(frameId)}${hash}`

/** Returns undefined outside the relay namespace and null for malformed routes. */
export const parseFrameRelayPath = (
  pathname: string
): FrameRelayRoute | null | undefined => {
  if (!pathname.startsWith(CRIT_FRAME_RELAY_PATH)) return undefined
  const encoded = pathname.slice(CRIT_FRAME_RELAY_PATH.length).split("/")
  if (encoded.length !== 2 || encoded.some((segment) => segment.length === 0)) {
    return null
  }
  try {
    return {
      canvasId: decodeURIComponent(encoded[0]!),
      frameId: decodeURIComponent(encoded[1]!)
    }
  } catch {
    return null
  }
}
