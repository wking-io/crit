import type { CanvasId, PresenceRoster } from "@crit/domain"
import { useEffect, useState } from "react"

import type { ReplicaSessionPorts } from "./replica-session.js"

export const useCanvasPresence = (args: {
  readonly canvasId: CanvasId
  readonly attend: ReplicaSessionPorts["attend"]
}): PresenceRoster | undefined => {
  const { attend, canvasId } = args
  const [snapshot, setSnapshot] = useState<{
    readonly canvasId: CanvasId
    readonly roster: PresenceRoster
  } | undefined>(undefined)

  useEffect(() => {
    return attend(canvasId, (roster) => {
      setSnapshot((current) => {
        if (current?.canvasId === canvasId && current.roster === roster) return current
        return { canvasId, roster }
      })
    })
  }, [attend, canvasId])

  return snapshot?.canvasId === canvasId ? snapshot.roster : undefined
}
