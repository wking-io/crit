import type { FormEvent, PointerEvent, WheelEvent } from "react"

import {
  NOTE_MINIMUM_THRESHOLD_GAP,
  setNoteCollapseThreshold,
  setNoteRevealThreshold,
  type NotePresentationThresholds
} from "./note-presentation.js"

const MINIMUM_THRESHOLD_PERCENT = 5
const MAXIMUM_THRESHOLD_PERCENT = 200
const MINIMUM_CANVAS_ZOOM_PERCENT = 5
const MAXIMUM_CANVAS_ZOOM_PERCENT = 200

export function NotePresentationControls({
  thresholds,
  zoom,
  onZoomChange,
  onChange
}: {
  readonly thresholds: NotePresentationThresholds
  readonly zoom: number
  readonly onZoomChange: (zoom: number) => void
  readonly onChange: (thresholds: NotePresentationThresholds) => void
}) {
  const changeCollapse = (event: FormEvent<HTMLInputElement>) => {
    const collapseBelowZoom = event.currentTarget.valueAsNumber / 100
    onChange(setNoteCollapseThreshold(thresholds, collapseBelowZoom))
  }
  const changeReveal = (event: FormEvent<HTMLInputElement>) => {
    const revealAboveZoom = event.currentTarget.valueAsNumber / 100
    onChange(setNoteRevealThreshold(thresholds, revealAboveZoom))
  }
  const stopPointer = (event: PointerEvent) => event.stopPropagation()
  const stopWheel = (event: WheelEvent) => event.stopPropagation()

  return (
    <aside
      aria-label="Canvas debug controls"
      className="crit-note-thresholds"
      onPointerDown={stopPointer}
      onWheel={stopWheel}
    >
      <header>
        <strong>Canvas debug</strong>
      </header>
      <label>
        <span>Canvas zoom</span>
        <output>{Math.round(zoom * 100)}%</output>
        <input
          aria-label="Canvas zoom"
          max={MAXIMUM_CANVAS_ZOOM_PERCENT}
          min={MINIMUM_CANVAS_ZOOM_PERCENT}
          onInput={(event) => onZoomChange(
            event.currentTarget.valueAsNumber / 100
          )}
          step="1"
          type="range"
          value={Math.round(zoom * 100)}
        />
      </label>
      <label>
        <span>Collapse below</span>
        <output>{Math.round(thresholds.collapseBelowZoom * 100)}%</output>
        <input
          aria-label="Collapse notes below"
          max={MAXIMUM_THRESHOLD_PERCENT - NOTE_MINIMUM_THRESHOLD_GAP * 100}
          min={MINIMUM_THRESHOLD_PERCENT}
          onInput={changeCollapse}
          step="1"
          type="range"
          value={Math.round(thresholds.collapseBelowZoom * 100)}
        />
      </label>
      <label>
        <span>Reveal above</span>
        <output>{Math.round(thresholds.revealAboveZoom * 100)}%</output>
        <input
          aria-label="Reveal notes above"
          max={MAXIMUM_THRESHOLD_PERCENT}
          min={MINIMUM_THRESHOLD_PERCENT + NOTE_MINIMUM_THRESHOLD_GAP * 100}
          onInput={changeReveal}
          step="1"
          type="range"
          value={Math.round(thresholds.revealAboveZoom * 100)}
        />
      </label>
    </aside>
  )
}
