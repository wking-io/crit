import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Button } from "@base-ui/react/button"
import { Effect } from "effect"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react"

import { useCritOverlayContainer } from "./overlay-container.js"

export interface ConfirmationDetails {
  readonly confirmLabel: string
  readonly description: string
  readonly title: string
}

export interface ConfirmationDialogProps extends ConfirmationDetails {
  readonly finalFocus?: AlertDialog.Popup.Props["finalFocus"]
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly open: boolean
}

export function ConfirmationDialog({
  confirmLabel,
  description,
  finalFocus,
  onCancel,
  onConfirm,
  open,
  title
}: ConfirmationDialogProps) {
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
        <AlertDialog.Popup
          className="crit-confirmation-dialog"
          finalFocus={finalFocus ?? true}
        >
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

type PendingConfirmation = ConfirmationDetails & {
  readonly resolve: (confirmed: boolean) => void
}

export type RequestConfirmation = (
  details: ConfirmationDetails
) => Promise<boolean>

export function confirmedEffect<A, E, R>(
  requestConfirmation: RequestConfirmation,
  details: ConfirmationDetails,
  effect: () => Effect.Effect<A, E, R>
): Effect.Effect<A | void, E, R> {
  return Effect.promise(() => requestConfirmation(details)).pipe(
    Effect.flatMap((confirmed) =>
      confirmed ? Effect.suspend(effect) : Effect.void
    )
  )
}

const ConfirmationContext = createContext<RequestConfirmation | null>(null)

export function ConfirmationProvider({ children }: {
  readonly children: ReactNode
}) {
  const pendingRef = useRef<PendingConfirmation | null>(null)
  const returnFocusRef = useRef<HTMLElement>(null)
  const [pending, setPending] = useState<PendingConfirmation | null>(null)

  const finish = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    if (current === null) return
    pendingRef.current = null
    setPending(null)
    current.resolve(confirmed)
  }, [])

  const request = useCallback<RequestConfirmation>((details) =>
    new Promise((resolve) => {
      if (pendingRef.current === null) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      }
      pendingRef.current?.resolve(false)
      const next = { ...details, resolve }
      pendingRef.current = next
      setPending(next)
    }), [])

  useEffect(() => () => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
  }, [])

  return (
    <ConfirmationContext.Provider value={request}>
      {children}
      <ConfirmationDialog
        confirmLabel={pending?.confirmLabel ?? "Confirm"}
        description={pending?.description ?? ""}
        finalFocus={returnFocusRef}
        onCancel={() => finish(false)}
        onConfirm={() => finish(true)}
        open={pending !== null}
        title={pending?.title ?? "Confirm action"}
      />
    </ConfirmationContext.Provider>
  )
}

export function useConfirmation() {
  const request = useContext(ConfirmationContext)
  if (request === null) {
    throw new Error("useConfirmation must be used within ConfirmationProvider")
  }
  return request
}
