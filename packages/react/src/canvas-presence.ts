import type { CanvasId, PresenceRoster } from "@crit/domain"
import { useAtomValue } from "@effect/atom-react"
import { Effect } from "effect"
import { Atom } from "effect/unstable/reactivity"

import type { ReplicaSessionPorts } from "./replica-session.js"

export const canvasPresenceAtom = Atom.family((canvasId: CanvasId) =>
  Atom.family((attend: ReplicaSessionPorts["attend"]) => {
    const state = Atom.make<PresenceRoster | undefined>(undefined)
    const lifecycle = Atom.make((get) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          attend(canvasId, (roster) => {
            if (get.registry.get(state) === roster) return
            get.registry.set(state, roster)
          })
        ),
        (unsubscribe) => Effect.sync(unsubscribe)
      ).pipe(Effect.andThen(Effect.never))
    ).pipe(Atom.setIdleTTL(0))
    return Atom.make((get) => {
      get(lifecycle)
      return get(state)
    }).pipe(Atom.setIdleTTL(0))
  })
)

export const useCanvasPresence = (args: {
  readonly canvasId: CanvasId
  readonly attend: ReplicaSessionPorts["attend"]
}): PresenceRoster | undefined =>
  useAtomValue(canvasPresenceAtom(args.canvasId)(args.attend))
