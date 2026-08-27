import { Button } from "@base-ui/react/button"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@base-ui/react/input"
import { Schema } from "effect"
import { useState, type FormEvent, type ReactElement } from "react"

import { useCritOverlayContainer } from "./overlay-container.js"
import { reviewActionPolicy } from "./review-actions.js"
import { reviewInformationalHelpTarget } from "./review-help.js"

const parsedFrameUrl = (value: string): URL | undefined => {
  try {
    const parsed = new URL(value.trim(), window.location.href)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

const inferredFrameTitle = (parsed: URL): string =>
  parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname

export function NewFrameDialog({
  onCancel,
  onCreate,
  open
}: {
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => boolean
  readonly open: boolean
}): ReactElement {
  const overlayContainer = useCritOverlayContainer()
  const create = reviewActionPolicy("add-frame")
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const submittedUrl = data.get("url")
    const submittedTitle = data.get("title")
    const urlValue = Schema.is(Schema.String)(submittedUrl) ? submittedUrl : ""
    const titleValue = Schema.is(Schema.String)(submittedTitle) ? submittedTitle : ""
    const parsed = parsedFrameUrl(urlValue)
    if (parsed === undefined) {
      setError("Enter a valid frame URL")
      return
    }
    const title = titleValue.trim() || inferredFrameTitle(parsed) || "Untitled frame"
    if (onCreate(parsed.href, title)) {
      setError(null)
      onCancel()
    }
  }

  return (
    <Dialog.Root
      modal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) {
          setError(null)
          onCancel()
        }
      }}
      open={open}
    >
      <Dialog.Portal container={overlayContainer}>
        <Dialog.Backdrop className="crit-dialog-backdrop" />
        <Dialog.Popup className="crit-new-frame-dialog crit-new-frame-dialog--popup">
          <form
            aria-label={create.label}
            className="crit-new-frame-dialog__form"
            onSubmit={submit}
          >
            <Dialog.Title>New frame</Dialog.Title>
            <label>
              URL
              <Input
                aria-label="Frame URL"
                autoFocus
                name="url"
                placeholder="https://example.com/iteration"
                required
                type="text"
                {...reviewInformationalHelpTarget({
                  name: "Frame URL",
                  description: "Enter the url to load in a new live frame."
                })}
              />
            </label>
            <label>
              Title <span>(optional)</span>
              <Input
                aria-label="Frame title"
                name="title"
                placeholder="Inferred from URL"
                type="text"
                {...reviewInformationalHelpTarget({
                  name: "Frame title",
                  description: "Name the frame. Optional, title is inferred when left blank."
                })}
              />
            </label>
            {error === null
              ? null
              : <p role="alert">{error}</p>}
            <div className="crit-new-frame-dialog__actions">
              <Dialog.Close type="button">Cancel</Dialog.Close>
              <Button data-primary="" type="submit">
                {create.label}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
