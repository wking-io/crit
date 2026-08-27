import type { CanvasCommandBatch, CanvasProjection } from "@crit/domain"
import { Effect, Match } from "effect"
import { createContext, useContext, type ReactElement, type ReactNode } from "react"

import {
  SnapshotRunState,
  useSnapshotRunner,
  type FrameSnapshotter
} from "./frame-snapshot.js"
import {
  ReviewActionInput,
  resolveReviewAction,
  reviewActionPolicies,
  type ReviewAction,
  type ReviewActionId,
  type ReviewActionInput as ReviewActionInputValue,
  type ReviewClientEffect,
  type ReviewSelection
} from "./review-actions.js"

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

export const useReviewRunner = ({
  fullscreen,
  onEffect,
  onSubmit,
  projection,
  selection,
  snapshotter
}: {
  readonly fullscreen: boolean
  readonly onEffect?: ((effect: ReviewClientEffect) => void) | undefined
  readonly onSubmit: (commands: CanvasCommandBatch) => void
  readonly projection: CanvasProjection
  readonly selection: ReviewSelection
  readonly snapshotter?: FrameSnapshotter | undefined
}) => {
  const snapshot = useSnapshotRunner({
    onSubmit,
    snapshotter: snapshotter ?? unavailableSnapshotter
  })
  const snapshotCapturing = SnapshotRunState.$is("capturing")(snapshot.state)
  const snapshotFailed = SnapshotRunState.$is("failed")(snapshot.state)
  const context = {
    projection,
    selection,
    input: ReviewActionInput.none(),
    fullscreen
  }
  const runnableIds = new Set<string>(reviewActionPolicies.flatMap((entry) => {
    if (!entry.available(selection, projection)) return []
    if (entry.id === "snapshot" && (snapshotter === undefined || snapshotCapturing)) {
      return []
    }
    return resolveReviewAction(entry.id, context) === null ? [] : [entry.id]
  }))

  const run = (
    id: ReviewActionId,
    input: ReviewActionInputValue = ReviewActionInput.none()
  ): boolean => {
    if (
      id === "snapshot" &&
      (snapshotter === undefined || snapshotCapturing)
    ) return false
    const action = resolveReviewAction(id, {
      projection,
      selection,
      input,
      fullscreen
    })
    if (action === null) return false
    dispatchReviewAction(action, onSubmit, onEffect, snapshot.begin)
    return true
  }

  return {
    run,
    runnableIds,
    snapshotCapturing,
    snapshotFailed
  }
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
      {children}
    </ReviewRunnerContext.Provider>
  )
}

export const useOptionalReviewRunner = () => useContext(ReviewRunnerContext)

export const useRequiredReviewRunner = (): ReviewRunner => {
  const runner = useContext(ReviewRunnerContext)
  if (runner === null) throw new Error("Review runner is not available")
  return runner
}
