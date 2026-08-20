import { Button } from "@base-ui/react/button"
import { Dialog } from "@base-ui/react/dialog"
import { Input } from "@base-ui/react/input"
import {
  useState,
  type FormEvent
} from "react"

import type { Author } from "../core/index.js"
import { useCritOverlayContainer } from "./overlay-container.js"

export const signedInAuthor = (name: string, email: string): Author => ({
  id: `signed-in:${email.trim().toLowerCase()}`,
  name: name.trim(),
  email: email.trim()
})

export const isSignInComplete = (name: string, email: string) =>
  name.trim().length > 0 && email.trim().includes("@")

export function SignInForm({
  onCancel,
  onSignIn,
  withinDialog = false
}: {
  readonly onCancel: () => void
  readonly onSignIn: (author: Author) => void
  readonly withinDialog?: boolean
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const complete = isSignInComplete(name, email)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!complete) return
    onSignIn(signedInAuthor(name, email))
    setName("")
    setEmail("")
  }

  return (
    <form
      className={withinDialog
        ? "crit-new-frame-dialog__form"
        : "crit-new-frame-dialog"}
      onSubmit={submit}
    >
      {withinDialog
        ? <Dialog.Title>Sign in to add frames and notes</Dialog.Title>
        : <h2>Sign in to add frames and notes</h2>}
      <p className="crit-new-frame-dialog__description">
        Crit uses your name on Notes and Comments. Sign in before adding
        a frame or note to this canvas.
      </p>
      <label>
        Name
        <Input
          autoFocus
          autoComplete="name"
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Ada Lovelace"
          required
          type="text"
          value={name}
        />
      </label>
      <label>
        Email
        <Input
          autoComplete="email"
          onChange={(event) => setEmail(event.currentTarget.value)}
          placeholder="ada@example.com"
          required
          type="email"
          value={email}
        />
      </label>
      <div className="crit-new-frame-dialog__actions">
        <Button
          onClick={onCancel}
          type="button"
        >
          Cancel
        </Button>
        <Button
          data-primary=""
          disabled={!complete}
          type="submit"
        >
          Sign in
        </Button>
      </div>
    </form>
  )
}

export function SignInDialog({
  onCancel,
  onSignIn,
  open
}: {
  readonly onCancel: () => void
  readonly onSignIn: (author: Author) => void
  readonly open: boolean
}) {
  const overlayContainer = useCritOverlayContainer()

  return (
    <Dialog.Root
      modal
      onOpenChange={(nextOpen) => {
        if (nextOpen || !open) return
        onCancel()
      }}
      open={open}
    >
      <Dialog.Portal container={overlayContainer}>
        <Dialog.Backdrop className="crit-dialog-backdrop" />
        <Dialog.Popup className="crit-new-frame-dialog crit-new-frame-dialog--popup">
          <SignInForm
            onCancel={onCancel}
            onSignIn={onSignIn}
            withinDialog
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
