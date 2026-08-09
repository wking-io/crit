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
        onClick={onSendToBack}
        onPointerDown={(event) => event.stopPropagation()}
        title="Send to back"
        type="button"
      >
        ⇩
      </button>
      <button
        aria-label={`Bring ${label} to front`}
        onClick={onBringToFront}
        onPointerDown={(event) => event.stopPropagation()}
        title="Bring to front"
        type="button"
      >
        ⇧
      </button>
    </span>
  )
}
