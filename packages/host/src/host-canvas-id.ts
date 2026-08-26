import { CanvasId } from "@crit/domain"
import { Result, Schema } from "effect"

const decodeCanvasId = Schema.decodeUnknownOption(CanvasId)

export const parseHostCanvasId = (raw: string): Result.Result<CanvasId, "invalid"> =>
  Result.fromOption(decodeCanvasId(raw), () => "invalid")

export const canvasHref = (canvasId: CanvasId, fragment: string): string =>
  `/canvas/${canvasId}${fragment}`

export const sessionHash = (fragment: string): string =>
  fragment.startsWith("#") ? fragment.slice(1) : fragment
