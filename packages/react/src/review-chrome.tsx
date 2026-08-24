import type { CanvasCommandBatch, CanvasProjection } from "@crit/domain"
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement
} from "react"

import {
  ReviewActionInput,
  availableReviewActions,
  resolveReviewAction,
  type ReviewAction,
  type ReviewActionId,
  type ReviewActionInput as ReviewActionInputValue,
  type ReviewClientEffect,
  type ReviewSelection
} from "./review-actions.js"

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
    id: "add-frame",
    label: "Add frame",
    inputLabel: "Frame URL",
    inputTag: "url"
  },
  {
    id: "rename-canvas",
    label: "Rename canvas",
    inputLabel: "Canvas title",
    inputTag: "text"
  },
  {
    id: "set-frame-title",
    label: "Set frame title",
    inputLabel: "Frame title",
    inputTag: "text"
  }
] as const satisfies readonly {
  readonly id: ReviewActionId
  readonly label: string
  readonly inputLabel: string
  readonly inputTag: "text" | "url"
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
  id,
  inputLabel,
  inputTag,
  label,
  onRun
}: {
  readonly id: ReviewActionId
  readonly inputLabel: string
  readonly inputTag: "text" | "url"
  readonly label: string
  readonly onRun: (
    id: ReviewActionId,
    input: ReviewActionInputValue
  ) => boolean
}): ReactElement {
  const [value, setValue] = useState("")
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = inputTag === "url"
      ? { _tag: "url" as const, url: value }
      : { _tag: "text" as const, text: value }
    if (onRun(id, input)) setValue("")
  }
  return (
    <form aria-label={label} onSubmit={submit}>
      <label>
        {inputLabel}
        <input
          aria-label={inputLabel}
          type={inputTag}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
      <button type="submit">{label}</button>
    </form>
  )
}

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)

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

  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      if (
        event.key !== "Delete" ||
        isTextEntry(event.target) ||
        !availableIds.has("remove")
      ) return
      event.preventDefault()
      run("remove")
    }
    window.addEventListener("keydown", remove)
    return () => window.removeEventListener("keydown", remove)
  })

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
      <div aria-label="Review actions" role="toolbar">
        {available.map((entry) =>
          formActionIds.has(entry.id)
            ? null
            : (
            <button
              aria-label={entry.label}
              key={entry.id}
              type="button"
              onClick={() => run(entry.id)}
            >
              {entry.label}
            </button>
            )
        )}
      </div>
      {formActions
        .filter(({ id }) => availableIds.has(id))
        .map((entry) => (
          <ReviewActionForm
            id={entry.id}
            inputLabel={entry.inputLabel}
            inputTag={entry.inputTag}
            key={entry.id}
            label={entry.label}
            onRun={run}
          />
        ))}
      <details>
        <summary>Help</summary>
        <ul>
          {available.map((entry) => (
            <li key={entry.id}>{entry.label}</li>
          ))}
        </ul>
      </details>
    </aside>
  )
}
