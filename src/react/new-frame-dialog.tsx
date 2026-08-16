import { Effect } from "effect"
import {
  useState,
  type FormEvent
} from "react"
import { createPortal } from "react-dom"

import { causeMessage } from "../internal/cause-message.js"
import { defaultRuntimeCapabilities } from "../runtime/runtime-capabilities.js"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import {
  actionHelpTarget,
  informationalHelpTarget
} from "./canvas-help.js"

export interface NewFrameFormProps {
  readonly autoFocus?: boolean
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => Effect.Effect<unknown, unknown>
  readonly onError: (message: string) => void
}

export function NewFrameForm({
  autoFocus = false,
  onCancel,
  onCreate,
  onError
}: NewFrameFormProps) {
  const controls = useCanvasControls(["canvas", "new-frame-form"], true)
  const runner = useCanvasActionRunner()
  const cancel = controls.action({ id: "cancel-new-frame" })
  const create = controls.action({ id: "create-frame" })
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const parsed = new URL(url.trim(), window.location.href)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Frame URL must use http or https")
      }
      const inferredTitle =
        parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname
      runner.run(
        controls,
        create,
        onCreate(
          parsed.href,
          title.trim() || inferredTitle || "Untitled frame"
        ),
        (cause) => onError(causeMessage(cause))
      )
    } catch (cause) {
      onError(causeMessage(cause, "Enter a valid frame URL"))
    }
  }

  return (
    <form className="crit-new-frame-dialog" onSubmit={submit}>
      <h2 id="crit-new-frame-title">New frame</h2>
      <label>
        URL
        <input
          autoFocus={autoFocus}
          {...informationalHelpTarget({
            name: "Frame URL",
            description: "Enter the url to load in a new live frame."
          })}
          onChange={(event) => setUrl(event.currentTarget.value)}
          placeholder="https://example.com/iteration"
          required
          type="text"
          value={url}
        />
      </label>
      <label>
        Title <span>(optional)</span>
        <input
          {...informationalHelpTarget({
            name: "Frame title",
            description: "Name the frame. Optional, title is inferred when left blank."
          })}
          onChange={(event) => setTitle(event.currentTarget.value)}
          placeholder="Inferred from URL"
          type="text"
          value={title}
        />
      </label>
      <div className="crit-new-frame-dialog__actions">
        <button
          aria-keyshortcuts={cancel.ariaKeyShortcuts ?? undefined}
          {...actionHelpTarget(cancel)}
          onClick={() => runner.run(controls, cancel, Effect.sync(onCancel))}
          type="button"
        >{cancel.label}</button>
        <button
          aria-keyshortcuts={create.ariaKeyShortcuts ?? undefined}
          data-primary=""
          disabled={create.availability !== "enabled"}
          {...actionHelpTarget(create)}
          type="submit"
        >{create.label}</button>
      </div>
    </form>
  )
}

export function NewFrameDialog({
  onCancel,
  onCreate,
  onError,
  open
}: {
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => Effect.Effect<unknown, unknown>
  readonly onError: (message: string) => void
  readonly open: boolean
}) {
  const controls = useCanvasControls(["canvas", "new-frame-form"], true)
  const runner = useCanvasActionRunner()
  const cancel = controls.action({ id: "cancel-new-frame" })

  const document = defaultRuntimeCapabilities.document()
  if (!open || document === undefined) return null

  return createPortal(
    <div
      aria-labelledby="crit-new-frame-title"
      aria-modal="true"
      className="crit-dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        runner.run(controls, cancel, Effect.sync(onCancel))
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          runner.run(controls, cancel, Effect.sync(onCancel))
        }
      }}
      role="dialog"
    >
      <NewFrameForm
        autoFocus
        onCancel={onCancel}
        onCreate={onCreate}
        onError={onError}
      />
    </div>,
    document.body
  )
}
