import type { CanvasId, PresenceRoster } from "@crit/domain"
import { useEffect, useState } from "react"

import type { ReplicaSessionPorts } from "./replica-session.js"

export const useCanvasPresence = (args: {
  readonly canvasId: CanvasId
  readonly attend: ReplicaSessionPorts["attend"]
}): PresenceRoster | undefined => {
  const { attend, canvasId } = args
  const [roster, setRoster] = useState<PresenceRoster | undefined>(undefined)

  useEffect(() => {
    setRoster(undefined)
    return attend(canvasId, setRoster)
  }, [attend, canvasId])

  return roster
}
