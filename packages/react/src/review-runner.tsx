import type { CanvasCommandBatch, CanvasProjection } from "@crit/domain"
import { Effect, Match } from "effect"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from "react"

import { CanvasSelection } from "./canvas-selection.js"
import { NewFrameDialog } from "./new-frame-dialog.js"
import {
  SnapshotRunState,
  useSnapshotRunner,
  type FrameSnapshotter
} from "./frame-snapshot.js"
import {
  ReviewActionInput,
  ReviewSelection,
  resolveReviewAction,
  resolveReviewActionPolicy,
  reviewActionPolicies,
  reviewActionPolicy,
  type ReviewAction,
  type ReviewActionId,
  type ReviewActionInput as ReviewActionInputValue,
  type ReviewClientEffect,
  type ReviewSelection as ReviewSelectionValue
} from "./review-actions.js"
import { ReviewHelpPanel, ReviewHelpSurface } from "./review-help.js"

const emptyReviewSelection = ReviewSelection.items({
  items: CanvasSelection.make([])
})

const unavailableSnapshotter = {
  capture: () => Effect.die("Snapshotter unavailable")
} satisfies FrameSnapshotter

const dispatchReviewAction = (
  action: ReviewAction,
  onSubmit: (commands: CanvasCommandBatch) => void,
  onEffect: ((effect: ReviewClientEffect) => void) | undefined,
  beginSnapshot: ReturnType<typeof useSnapshotRunner>["begin"]
): void => Match.value(action).pipe(Match.tagsExhaustive({
  batch: ({ commands }) => onSubmit(commands),
  effect: ({ effect }) => {
    onEffect?.(effect)
  },
  snapshot: ({ request }) => beginSnapshot(request)
}))

const reviewRunnableIds = (
  selection: ReviewSelectionValue,
  projection: CanvasProjection,
  fullscreen: boolean,
  snapshotter: FrameSnapshotter | undefined,
  snapshotCapturing: boolean
): ReadonlySet<string> => {
  return new Set<string>(reviewActionPolicies.flatMap((entry) => {
    if (!entry.available(selection, projection)) return []
    if (entry.id === "snapshot" && (snapshotter === undefined || snapshotCapturing)) {
      return []
    }
    if (entry.id === "enter-fullscreen" && fullscreen) return []
    if (entry.id === "exit-fullscreen" && !fullscreen) return []
    return [entry.id]
  }))
}

export const useReviewRunner = ({
  fullscreen,
  getSelection,
  onEffect,
  onSubmit,
  projection,
  selection,
  snapshotter
}: {
  readonly fullscreen: boolean
  readonly getSelection?: () => ReviewSelectionValue
  readonly onEffect?: ((effect: ReviewClientEffect) => void) | undefined
  readonly onSubmit: (commands: CanvasCommandBatch) => void
  readonly projection: CanvasProjection
  readonly selection?: ReviewSelectionValue
  readonly snapshotter?: FrameSnapshotter | undefined
}) => {
  const snapshot = useSnapshotRunner({
    onSubmit,
    snapshotter: snapshotter ?? unavailableSnapshotter
  })
  const snapshotCapturing = SnapshotRunState.$is("capturing")(snapshot.state)
  const snapshotFailed = SnapshotRunState.$is("failed")(snapshot.state)
  const getSelectionRef = useRef(getSelection ?? (() => selection ?? emptyReviewSelection))
  getSelectionRef.current = getSelection ?? (() => selection ?? emptyReviewSelection)
  const runnableIds = useMemo(() => {
    return () => reviewRunnableIds(
      getSelectionRef.current(),
      projection,
      fullscreen,
      snapshotter,
      snapshotCapturing
    )
  }, [fullscreen, projection, snapshotCapturing, snapshotter])

  const beginSnapshot = snapshot.begin
  const actionFor = useCallback((
    id: ReviewActionId,
    targetSelection: ReviewSelectionValue
  ) => {
    const declaration = reviewActionPolicy(id)
    const runnable = reviewRunnableIds(
      targetSelection,
      projection,
      fullscreen,
      snapshotter,
      snapshotCapturing
    ).has(id)
    return resolveReviewActionPolicy(declaration, {
      projection,
      selection: targetSelection,
      available: runnable,
      unavailableReason: id === "snapshot" && snapshotter === undefined
        ? "snapshot-unavailable"
        : id === "snapshot" && snapshotCapturing
          ? "action-pending"
          : declaration.unavailableReason,
      unavailableMessage: id === "snapshot" && snapshotter === undefined
        ? "Snapshot capture is not available for this Frame."
        : id === "snapshot" && snapshotCapturing
          ? "Wait for the current snapshot to finish."
          : declaration.unavailableMessage
    })
  }, [fullscreen, projection, snapshotCapturing, snapshotter])
  const action = useCallback((id: ReviewActionId) =>
    actionFor(id, getSelectionRef.current()), [actionFor])
  const runFor = useCallback((
    id: ReviewActionId,
    targetSelection: ReviewSelectionValue,
    input: ReviewActionInputValue = ReviewActionInput.none()
  ): boolean => {
    if (
      id === "snapshot" &&
      (snapshotter === undefined || snapshotCapturing)
    ) return false
    const action = resolveReviewAction(id, {
      projection,
      selection: targetSelection,
      input,
      fullscreen
    })
    if (action === null) return false
    dispatchReviewAction(action, onSubmit, onEffect, beginSnapshot)
    return true
  }, [
    beginSnapshot,
    fullscreen,
    onEffect,
    onSubmit,
    projection,
    snapshotCapturing,
    snapshotter
  ])
  const run = useCallback((
    id: ReviewActionId,
    input: ReviewActionInputValue = ReviewActionInput.none()
  ) => runFor(id, getSelectionRef.current(), input), [runFor])

  const [addFramePlacement, setAddFramePlacement] = useState<{
    readonly x: number
    readonly y: number
  } | null>(null)
  const requestAddFrame = useCallback((
    placement: { readonly x: number; readonly y: number }
  ) => {
    setAddFramePlacement(placement)
  }, [])
  const closeAddFrame = useCallback(() => {
    setAddFramePlacement(null)
  }, [])

  return useMemo(() => ({
    addFramePlacement,
    action,
    actionFor,
    closeAddFrame,
    requestAddFrame,
    run,
    runFor,
    runnableIds,
    snapshotAvailable: snapshotter !== undefined,
    snapshotCapturing,
    snapshotFailed
  }), [
    addFramePlacement,
    action,
    actionFor,
    closeAddFrame,
    requestAddFrame,
    run,
    runFor,
    runnableIds,
    snapshotter,
    snapshotCapturing,
    snapshotFailed
  ])
}

export type ReviewRunner = ReturnType<typeof useReviewRunner>

const ReviewRunnerContext = createContext<ReviewRunner | null>(null)

export function ReviewRunnerProvider({
  children,
  ...props
}: Parameters<typeof useReviewRunner>[0] & {
  readonly children: ReactNode
}): ReactElement {
  const runner = useReviewRunner(props)
  return (
    <ReviewRunnerContext.Provider value={runner}>
      <ReviewHelpSurface className="crit-review-help-surface">
        {children}
        <NewFrameDialog
          onCancel={runner.closeAddFrame}
          onCreate={(url, title) => {
            const placement = runner.addFramePlacement
            if (placement === null) return false
            return runner.run("add-frame", ReviewActionInput.addFrame({
              title,
              url,
              x: placement.x,
              y: placement.y
            }))
          }}
          open={runner.addFramePlacement !== null}
        />
        <ReviewHelpPanel />
      </ReviewHelpSurface>
    </ReviewRunnerContext.Provider>
  )
}

export const useOptionalReviewRunner = () => useContext(ReviewRunnerContext)
