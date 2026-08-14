import { Effect } from "effect"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import { actionHelpTarget } from "./canvas-help.js"
import { Glyph } from "./glyph.js"

export function OrderControls({
  id,
  kind,
  label,
  onBringToFront,
  onSendToBack
}: {
  readonly id: string
  readonly kind: "frame" | "note"
  readonly label: string
  readonly onBringToFront: () => void
  readonly onSendToBack: () => void
}) {
  const controls = useCanvasControls(["canvas"], true)
  const runner = useCanvasActionRunner()
  const target = { kind, id, label }
  const sendToBack = controls.action({ id: "send-item-to-back", target })
  const bringToFront = controls.action({ id: "bring-item-to-front", target })
  return (
    <span style={{ display: "flex", flex: "0 0 auto", gap: 4 }}>
      <button
        aria-label={`Send ${label} to back`}
        disabled={sendToBack.availability !== "enabled"}
        {...actionHelpTarget(sendToBack)}
        onClick={() => runner.run(
          controls,
          sendToBack,
          Effect.sync(onSendToBack)
        )}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <Glyph name="layerBack" />
      </button>
      <button
        aria-label={`Bring ${label} to front`}
        disabled={bringToFront.availability !== "enabled"}
        {...actionHelpTarget(bringToFront)}
        onClick={() => runner.run(
          controls,
          bringToFront,
          Effect.sync(onBringToFront)
        )}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <Glyph name="layerFront" />
      </button>
    </span>
  )
}
