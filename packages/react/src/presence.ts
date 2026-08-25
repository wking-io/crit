import type {
  CanvasId,
  PresenceRoster
} from "@crit/domain"
import {
  Effect,
  Fiber,
  Stream,
  type Scope
} from "effect"
import {
  useEffect,
  useState
} from "react"

export interface PresencePorts<E = never> {
  readonly attend: (
    canvasId: CanvasId
  ) => Effect.Effect<
    Stream.Stream<PresenceRoster, E>,
    E,
    Scope.Scope
  >
}

export type PresenceRun = (
  effect: Effect.Effect<void>
) => Fiber.Fiber<void, never>

export const usePresence = <E>(args: {
  readonly canvasId: CanvasId
  readonly ports: PresencePorts<E>
  readonly run: PresenceRun
}): PresenceRoster | undefined => {
  const { canvasId, ports, run } = args
  const [presence, setPresence] = useState<PresenceRoster>()

  useEffect(() => {
    setPresence(undefined)
    const fiber = run(Effect.scoped(
      ports.attend(canvasId).pipe(
        Effect.flatMap(Stream.runForEach((roster) =>
          Effect.sync(() => setPresence(roster))
        )),
        Effect.ignore
      )
    ))
    return () => {
      run(Fiber.interrupt(fiber))
    }
  }, [canvasId, ports, run])

  return presence
}
