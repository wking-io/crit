import { Cause, Effect, Fiber } from "effect"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"

import {
  CanvasControls,
  canvasControlPlatform,
  type CanvasControlScope,
  type CanvasControlsInstance,
  type ResolvedCanvasAction
} from "./canvas-controls.js"

type CanvasActionRunner = {
  readonly pendingActions: ReadonlyArray<string>
  readonly run: <A, E>(
    controls: CanvasControlsInstance,
    action: ResolvedCanvasAction,
    effect: Effect.Effect<A, E>,
    onFailure?: (cause: unknown) => void
  ) => void
}

export type CanvasActionExecutor = {
  readonly pendingActions: () => ReadonlyArray<string>
  readonly run: CanvasActionRunner["run"]
  readonly dispose: () => void
}

export const makeCanvasActionExecutor = ({
  onError,
  onPendingChange
}: {
  readonly onError?: (cause: unknown) => void
  readonly onPendingChange?: (pending: ReadonlyArray<string>) => void
} = {}): CanvasActionExecutor => {
  const pending = new Set<string>()
  const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>()
  const notifyPending = () => onPendingChange?.([...pending])
  const run: CanvasActionRunner["run"] = (
    controls,
    action,
    effect,
    onFailure
  ) => {
    if (pending.has(action.key)) return
    pending.add(action.key)
    notifyPending()
    const fiber = Effect.runFork(
      controls.invoke(action, effect).pipe(
        Effect.catchTag("CanvasActionUnavailable", () => Effect.void),
        Effect.matchCause({
          onFailure: (cause) => {
            if (!Cause.hasInterruptsOnly(cause)) {
              (onFailure ?? onError)?.(Cause.squash(cause))
            }
          },
          onSuccess: () => undefined
        }),
        Effect.ensuring(Effect.sync(() => {
          pending.delete(action.key)
          fibers.delete(action.key)
          notifyPending()
        }))
      )
    )
    if (pending.has(action.key)) fibers.set(action.key, fiber)
  }
  return {
    pendingActions: () => [...pending],
    run,
    dispose: () => {
      for (const fiber of fibers.values()) Effect.runFork(Fiber.interrupt(fiber))
      fibers.clear()
    }
  }
}

const CanvasActionRunnerContext = createContext<CanvasActionRunner | null>(null)

export function CanvasActionRunnerProvider({
  children,
  onError
}: {
  readonly children: ReactNode
  readonly onError?: (cause: unknown) => void
}) {
  const [pendingActions, setPendingActions] = useState<ReadonlyArray<string>>([])
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const executorRef = useRef<CanvasActionExecutor | null>(null)
  executorRef.current ??= makeCanvasActionExecutor({
    onError: (cause) => onErrorRef.current?.(cause),
    onPendingChange: setPendingActions
  })
  const executor = executorRef.current

  useEffect(() => () => executor.dispose(), [executor])

  const value = useMemo(
    () => ({ pendingActions, run: executor.run }),
    [executor, pendingActions]
  )
  return (
    <CanvasActionRunnerContext.Provider value={value}>
      {children}
    </CanvasActionRunnerContext.Provider>
  )
}

export const useCanvasActionRunner = () => {
  const runner = useContext(CanvasActionRunnerContext)
  if (runner === null) {
    throw new TypeError("Canvas actions must be rendered inside CanvasActionRunnerProvider")
  }
  return runner
}

export const useCanvasControls = (
  activeScopes: ReadonlyArray<CanvasControlScope>,
  commentAuthorPresent: boolean
) => {
  const runner = useCanvasActionRunner()
  const scopesKey = [...activeScopes].sort().join("|")
  return useMemo(() => CanvasControls.resolve({
    platform: canvasControlPlatform(),
    activeScopes: scopesKey.split("|") as Array<CanvasControlScope>,
    globalFacts: { commentAuthorPresent },
    pendingActions: runner.pendingActions
  }), [commentAuthorPresent, runner.pendingActions, scopesKey])
}
