import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Button } from "@base-ui/react/button"
import { type ReactElement } from "react"

import { useCritOverlayContainer } from "./overlay-container.js"

export interface ConfirmationDetails {
  readonly confirmLabel: string
  readonly description: string
  readonly title: string
}

export function ConfirmationDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  title
}: ConfirmationDetails & {
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly open: boolean
}): ReactElement {
  const overlayContainer = useCritOverlayContainer()
  return (
    <AlertDialog.Root
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel()
      }}
      open={open}
    >
      <AlertDialog.Portal container={overlayContainer}>
        <AlertDialog.Backdrop className="crit-dialog-backdrop" />
        <AlertDialog.Popup className="crit-confirmation-dialog">
          <div className="crit-confirmation-dialog__intro">
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
          </div>
          <div className="crit-confirmation-dialog__actions">
            <AlertDialog.Close>Cancel</AlertDialog.Close>
            <Button data-tone="danger" onClick={onConfirm} type="button">
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
