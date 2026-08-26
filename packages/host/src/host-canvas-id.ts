import { CanvasId, Id } from "@crit/domain"
import { Result, Schema } from "effect"

export const localCanvasId = Id.canvas("canvas_local")

const decodeCanvasId = Schema.decodeUnknownOption(CanvasId)

export const parseHostCanvasId = (search: string): Result.Result<CanvasId, "invalid"> => {
  const raw = new URLSearchParams(search).get("canvas")
  if (raw === null) return Result.succeed(localCanvasId)
  return Result.fromOption(decodeCanvasId(raw), () => "invalid")
}
