import type { LocalCanvasClientService } from "@crit/client"
import type { CanvasId, CanvasTitle } from "@crit/domain"
import { Effect } from "effect"

export type EnsureLocalCanvasClient = Pick<LocalCanvasClientService, "create" | "open">

export const ensureLocalCanvas = ({ canvasId, client, title }: {
  readonly client: EnsureLocalCanvasClient
  readonly canvasId: CanvasId
  readonly title: CanvasTitle
}) =>
  client.create({ canvasId, title }).pipe(
    Effect.catchTag("canvasAlreadyExists", () => client.open(canvasId))
  )
