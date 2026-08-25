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

const formPolicies = formActions.map((entry) => {
  const policy = reviewActionPolicies.find((candidate) => candidate.id === entry.id)
  if (policy === undefined) {
    throw new Error(`Missing form policy: ${entry.id}`)
  }
  return { ...entry, policy }
})

const formActionIds = new Set<string>(formPolicies.map(({ id }) => id))

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
  projection,
  selection
}: ReviewChromeProps): ReactElement {
  const context = {
    projection,
    selection,
    input: ReviewActionInput.none,
    fullscreen
  }
  const available = availableReviewActions(context)
  const runnable = available.filter((entry) =>
    resolveReviewAction(entry.id, context) !== null
  )
  const runnableIds = new Set<string>(runnable.map(({ id }) => id))
  const toolbarActions = runnable.filter((entry) => !formActionIds.has(entry.id))
  const visibleForms = formPolicies.filter(({ policy }) =>
    policy.available(selection, projection)
  )
  const run = (
    id: ReviewActionId,
    input: ReviewActionInputValue = ReviewActionInput.none
  ): boolean => {
    const action = resolveReviewAction(id, {
      projection,
      selection,
      input,
      fullscreen
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
        options: {
          enabled: runnableIds.has(policy.id),
          ignoreInputs: hotkey !== "Escape"
        }
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
          {toolbarActions.map((entry) => (
            <button
              aria-label={entry.label}
              key={entry.id}
              type="button"
              {...reviewActionHelpTarget(entry)}
              onClick={() => run(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {visibleForms.map((entry) => (
          <ReviewActionForm
            inputLabel={entry.inputLabel}
            key={entry.id}
            onRun={run}
            policy={entry.policy}
          />
        ))}
        <ReviewHelpPanel />
      </ReviewHelpSurface>
    </aside>
  )
}
