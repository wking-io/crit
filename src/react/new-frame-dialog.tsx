import { useHotkey } from "@tanstack/react-hotkeys"
import {
  useEffect,
  useState,
  type FormEvent
} from "react"
import { createPortal } from "react-dom"

export function NewFrameDialog({
  onCancel,
  onCreate,
  onError,
  open
}: {
  readonly onCancel: () => void
  readonly onCreate: (url: string, title: string) => void
  readonly onError: (message: string) => void
  readonly open: boolean
}) {
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  useHotkey("Escape", onCancel, {
    conflictBehavior: "allow",
    enabled: open,
    ignoreInputs: false
  })

  useEffect(() => {
    if (!open) {
      setTitle("")
      setUrl("")
    }
  }, [open])

  if (!open || typeof document === "undefined") return null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const parsed = new URL(url.trim(), window.location.href)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Frame URL must use http or https")
      }
      const inferredTitle =
        parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname
      onCreate(parsed.href, title.trim() || inferredTitle || "Untitled frame")
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Enter a valid frame URL")
    }
  }

  return createPortal(
    <div
      aria-labelledby="crit-new-frame-title"
      aria-modal="true"
      className="crit-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      role="dialog"
    >
      <form className="crit-new-frame-dialog" onSubmit={submit}>
        <h2 id="crit-new-frame-title">New frame</h2>
        <label>
          URL
          <input
            autoFocus
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
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Inferred from URL"
            type="text"
            value={title}
          />
        </label>
        <div className="crit-new-frame-dialog__actions">
          <button onClick={onCancel} type="button">Cancel</button>
          <button data-primary="" type="submit">Add frame</button>
        </div>
      </form>
    </div>,
    document.body
  )
}
