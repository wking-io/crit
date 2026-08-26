import { CanvasId } from "@crit/domain"
import { Data, Option, Schema } from "effect"

export type HostLocation = Data.TaggedEnum<{
  readonly index: {}
  readonly canvas: { readonly canvasId: CanvasId }
  readonly invalid: {}
}>
export const HostLocation = Data.taggedEnum<HostLocation>()

const decodeCanvasId = Schema.decodeUnknownOption(CanvasId)

export const parseHostLocation = (search: string): HostLocation => {
  const raw = new URLSearchParams(search).get("canvas")
  if (raw === null) return HostLocation.index()
  return Option.match(decodeCanvasId(raw), {
    onNone: () => HostLocation.invalid(),
    onSome: (canvasId) => HostLocation.canvas({ canvasId })
  })
}

export const canvasIndexHref = (canvasId: CanvasId, fragment: string): string =>
  `?canvas=${canvasId}${fragment}`
