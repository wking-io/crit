import { Button } from "@base-ui/react/button"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@base-ui/react/input"
import { Schema } from "effect"
import { type FormEvent, type ReactElement } from "react"

import { useCritOverlayContainer } from "./overlay-container.js"
import { reviewActionPolicy } from "./review-actions.js"

export function CanvasTitleDialog({
  onOpenChange,
  onSave,
  open,
  title
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (title: string) => boolean
  readonly open: boolean
  readonly title: string
}): ReactElement {
  const overlayContainer = useCritOverlayContainer()
  const cancel = reviewActionPolicy("rename-canvas")

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const submitted = new FormData(event.currentTarget).get("title")
    const nextTitle = Schema.is(Schema.String)(submitted) ? submitted.trim() : ""
    if (nextTitle.length === 0 || nextTitle === title) return
    if (onSave(nextTitle)) onOpenChange(false)
  }

  return (
    <Dialog.Root
      modal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) onOpenChange(false)
      }}
      open={open}
    >
      <Dialog.Portal container={overlayContainer}>
        <Dialog.Backdrop className="crit-dialog-backdrop" />
        <Dialog.Popup className="crit-new-frame-dialog crit-new-frame-dialog--popup">
          <form
            aria-label={cancel.label}
            className="crit-new-frame-dialog__form"
            onSubmit={submit}
          >
            <Dialog.Title>Rename canvas</Dialog.Title>
            <Dialog.Description className="crit-new-frame-dialog__description">
              Change the title shown in Crit. The canvas ID stays the same.
            </Dialog.Description>
            <label>
              Title
              <Input
                aria-label="Canvas title"
                autoFocus
                defaultValue={title}
                key={title}
                name="title"
                required
                type="text"
              />
            </label>
            <div className="crit-new-frame-dialog__actions">
              <Dialog.Close type="button">Cancel</Dialog.Close>
              <Button data-primary="" type="submit">
                Save title
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
