import { Button } from "@base-ui/react/button"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@base-ui/react/input"
import { Effect } from "effect"
import {
  useState,
  type FormEvent
} from "react"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import { causeMessage } from "../internal/cause-message.js"
import {
  actionHelpTarget,
  informationalHelpTarget
} from "./canvas-help.js"
import { useCritOverlayContainer } from "./overlay-container.js"

export interface NewFrameFormProps {
  readonly autoFocus?: boolean
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => Effect.Effect<unknown, unknown>
  readonly onError: (message: string) => void
  readonly withinDialog?: boolean
}

export function NewFrameForm({
  autoFocus = false,
  onCancel,
  onCreate,
  onError,
  withinDialog = false
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
    <form
      className={withinDialog
        ? "crit-new-frame-dialog__form"
        : "crit-new-frame-dialog"}
      onSubmit={submit}
    >
      {withinDialog
        ? <Dialog.Title id="crit-new-frame-title">New frame</Dialog.Title>
        : <h2 id="crit-new-frame-title">New frame</h2>}
      <label>
        URL
        <Input
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
        <Input
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
        {withinDialog
          ? (
            <Dialog.Close
              aria-keyshortcuts={cancel.ariaKeyShortcuts ?? undefined}
              {...actionHelpTarget(cancel)}
              type="button"
            >{cancel.label}</Dialog.Close>
          )
          : (
            <Button
              aria-keyshortcuts={cancel.ariaKeyShortcuts ?? undefined}
              {...actionHelpTarget(cancel)}
              onClick={() => runner.run(controls, cancel, Effect.sync(onCancel))}
              type="button"
            >{cancel.label}</Button>
          )}
        <Button
          aria-keyshortcuts={create.ariaKeyShortcuts ?? undefined}
          data-primary=""
          disabled={create.availability !== "enabled"}
          {...actionHelpTarget(create)}
          type="submit"
        >{create.label}</Button>
      </div>
    </form>
  )
}

export function NewFrameDialog({
  onCancel,
  onCreate,
  onError,
  finalFocus,
  open
}: {
  readonly finalFocus?: Dialog.Popup.Props["finalFocus"]
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => Effect.Effect<unknown, unknown>
  readonly onError: (message: string) => void
  readonly open: boolean
}) {
  const controls = useCanvasControls(["canvas", "new-frame-form"], true)
  const runner = useCanvasActionRunner()
  const overlayContainer = useCritOverlayContainer()
  const cancel = controls.action({ id: "cancel-new-frame" })

  return (
    <Dialog.Root
      modal
      onOpenChange={(nextOpen) => {
        if (nextOpen || !open) return
        runner.run(controls, cancel, Effect.sync(onCancel))
      }}
      open={open}
    >
      <Dialog.Portal container={overlayContainer}>
        <Dialog.Backdrop className="crit-dialog-backdrop" />
        <Dialog.Popup
          className="crit-new-frame-dialog crit-new-frame-dialog--popup"
          finalFocus={finalFocus ?? true}
        >
          <NewFrameForm
            autoFocus
            onCancel={onCancel}
            onCreate={onCreate}
            onError={onError}
            withinDialog
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
