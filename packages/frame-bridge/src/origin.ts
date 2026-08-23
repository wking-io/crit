import { FrameBridgeOrigin } from "@crit/protocol"
import { Option, Schema } from "effect"

export const isTrustedFrameBridgeEvent = (
  event: {
    readonly origin: string
    readonly source: unknown
  },
  peer: {
    readonly origin: FrameBridgeOrigin
    readonly source: unknown
  }
) => event.source === peer.source && event.origin === peer.origin

export const frameBridgeOriginFromHref = (
  href: string
): Option.Option<FrameBridgeOrigin> => {
  try {
    return Schema.decodeUnknownOption(FrameBridgeOrigin)(new URL(href).origin)
  } catch {
    return Option.none()
  }
}
