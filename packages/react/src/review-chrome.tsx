import type { CanvasCommandBatch, CanvasProjection } from "@crit/domain"
import { useHotkeys } from "@tanstack/react-hotkeys"
import {
  useState,
  type FormEvent,
  type ReactElement
} from "react"

import {
  ReviewActionInput,
  availableReviewActions,
  resolveReviewAction,
  reviewActionPolicies,
  type ReviewAction,
  type ReviewActionId,
  type ReviewActionInput as ReviewActionInputValue,
  type ReviewClientEffect,
  type ReviewSelection
} from "./review-actions.js"
import {
  ReviewHelpPanel,
  ReviewHelpSurface,
  reviewActionHelpTarget
} from "./review-help.js"

export interface ReviewChromeProps {
  readonly projection: CanvasProjection
  readonly selection: ReviewSelection
  readonly onSubmit: (commands: CanvasCommandBatch) => void
  readonly onEffect?: (effect: ReviewClientEffect) => void
  readonly fullscreen?: boolean
  readonly pauseOffscreen?: boolean
}

const formActions = [
  {
    id: "rename-canvas",
    inputLabel: "Canvas title"
  },
  {
    id: "set-frame-title",
    inputLabel: "Frame title"
  }
] as const satisfies readonly {
  readonly id: ReviewActionId
  readonly inputLabel: string
}[]

const formActionIds = new Set<string>(formActions.map(({ id }) => id))

const dispatchReviewAction = (
  action: ReviewAction,
  onSubmit: ReviewChromeProps["onSubmit"],
  onEffect: ReviewChromeProps["onEffect"]
): void => {
  if (action._tag === "batch") {
    onSubmit(action.commands)
    return
  }
  onEffect?.(action.effect)
}

function ReviewActionForm({
  inputLabel,
  onRun,
  policy
}: {
  readonly inputLabel: string
  readonly onRun: (
    id: ReviewActionId,
    input: ReviewActionInputValue
  ) => boolean
  readonly policy: (typeof reviewActionPolicies)[number]
}): ReactElement {
  const [value, setValue] = useState("")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (onRun(policy.id, { _tag: "text", text: value })) setValue("")
  }
  return (
    <form
      aria-label={policy.label}
      {...reviewActionHelpTarget(policy)}
      onSubmit={submit}
    >
      <label>
        {inputLabel}
        <input
          aria-label={inputLabel}
          type="text"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
      <button type="submit">{policy.label}</button>
    </form>
  )
}

export function ReviewChrome({
  fullscreen = false,
  onEffect,
  onSubmit,
  pauseOffscreen = false,
  projection,
  selection
}: ReviewChromeProps): ReactElement {
  const context = {
    projection,
    selection,
    input: ReviewActionInput.none,
    fullscreen,
    pauseOffscreen
  }
  const available = availableReviewActions(context).filter((entry) =>
    resolveReviewAction(entry.id, context) !== null || formActionIds.has(entry.id)
  )
  const availableIds = new Set<string>(available.map(({ id }) => id))
  const run = (
    id: ReviewActionId,
    input: ReviewActionInputValue = ReviewActionInput.none
  ): boolean => {
    const action = resolveReviewAction(id, {
      projection,
      selection,
      input,
      fullscreen,
      pauseOffscreen
    })
    if (action === null) return false
    dispatchReviewAction(action, onSubmit, onEffect)
    return true
  }

  useHotkeys(
    reviewActionPolicies.flatMap((policy) =>
      policy.shortcuts.map((hotkey) => ({
        hotkey,
        callback: () => {
          run(policy.id)
        },
        options: { enabled: availableIds.has(policy.id) }
      }))
    )
  )

  return (
    <aside
      aria-label="Review controls"
      style={{
        background: "white",
        display: "grid",
        gap: 8,
        left: 8,
        maxWidth: 360,
        padding: 8,
        position: "absolute",
        top: 8,
        zIndex: 10_000
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ReviewHelpSurface>
        <div aria-label="Review actions" role="toolbar">
          {available.map((entry) =>
            formActionIds.has(entry.id)
              ? null
              : (
              <button
                aria-label={entry.label}
                key={entry.id}
                type="button"
                {...reviewActionHelpTarget(entry)}
                onClick={() => run(entry.id)}
              >
                {entry.label}
              </button>
              )
          )}
        </div>
        {formActions
          .filter(({ id }) => availableIds.has(id))
          .map((entry) => {
            const policy = reviewActionPolicies.find((candidate) =>
              candidate.id === entry.id
            )
            return policy === undefined
              ? null
              : (
                <ReviewActionForm
                  inputLabel={entry.inputLabel}
                  key={entry.id}
                  onRun={run}
                  policy={policy}
                />
              )
          })}
        <ReviewHelpPanel />
      </ReviewHelpSurface>
    </aside>
  )
}
