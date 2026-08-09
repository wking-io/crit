import { NO_HELP_HOTKEY, helpTarget } from "./canvas-help.js"

export function OrderControls({
  label,
  onBringToFront,
  onSendToBack
}: {
  readonly label: string
  readonly onBringToFront: () => void
  readonly onSendToBack: () => void
}) {
  return (
    <span style={{ display: "flex", flex: "0 0 auto", gap: 4 }}>
      <button
        aria-label={`Send ${label} to back`}
        {...helpTarget({
          name: "Send to back",
          hotkey: NO_HELP_HOTKEY,
          description: `Place this ${label} behind every other canvas item.`
        })}
        onClick={onSendToBack}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        ⇩
      </button>
      <button
        aria-label={`Bring ${label} to front`}
        {...helpTarget({
          name: "Bring to front",
          hotkey: NO_HELP_HOTKEY,
          description: `Place this ${label} above every other canvas item.`
        })}
        onClick={onBringToFront}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        ⇧
      </button>
    </span>
  )
}
