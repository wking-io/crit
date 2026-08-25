import type {
  LocalCanvasClientService,
  PresenceAttendFailure
} from "@crit/client"
import type { PresencePorts } from "@crit/react"
import { ConnectedPersonClaim } from "@crit/replica/http"
import { Effect } from "effect"
import * as Socket from "effect/unstable/socket/Socket"

export const localPresencePorts = (
  client: LocalCanvasClientService
): PresencePorts<PresenceAttendFailure> => ({
  attend: (canvasId) => client.attendPresence(
    canvasId,
    ConnectedPersonClaim.make({})
  ).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
})
