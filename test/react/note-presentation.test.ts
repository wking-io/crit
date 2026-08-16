import { describe, expect, it } from "vitest"

import {
  activateNotePresentation,
  initialNotePresentationState,
  noteIntrinsicWidth,
  notePresentation,
  setNoteCollapseThreshold,
  setNoteRevealThreshold
} from "../../src/react/note-presentation.js"

const longText = "The hierarchy is working. Tighten the spacing between the title and supporting copy before the next review."

describe("Note presentation", () => {
  it("derives a compact width up to a 42-character reading measure", () => {
    expect(noteIntrinsicWidth("Align this title.")).toEqual({
      lineCharacters: 28,
      width: 230
    })
    expect(noteIntrinsicWidth("Tighten the spacing below this title.")).toEqual({
      lineCharacters: 37,
      width: 295
    })
    expect(noteIntrinsicWidth(longText)).toEqual({
      lineCharacters: 42,
      width: 332
    })
  })

  it("uses separate collapse and reveal thresholds to avoid flicker", () => {
    let state = initialNotePresentationState(longText, .6)

    let presentation = notePresentation(longText, .51, state)
    expect(presentation.mode).toBe("preview")

    presentation = notePresentation(longText, .49, presentation.state)
    expect(presentation.mode).toBe("collapsed")

    presentation = notePresentation(longText, .51, presentation.state)
    expect(presentation.mode).toBe("collapsed")

    presentation = notePresentation(longText, .53, presentation.state)
    expect(presentation.mode).toBe("preview")
  })

  it("applies live canvas threshold overrides", () => {
    const thresholds = { collapseBelowZoom: .6, revealAboveZoom: .7 }
    let state = initialNotePresentationState(longText, .75, false, thresholds)
    expect(state.automaticMode).toBe("preview")

    let presentation = notePresentation(longText, .55, state, thresholds)
    expect(presentation.mode).toBe("collapsed")

    presentation = notePresentation(longText, .65, presentation.state, thresholds)
    expect(presentation.mode).toBe("collapsed")

    presentation = notePresentation(longText, .75, presentation.state, thresholds)
    expect(presentation.mode).toBe("preview")
  })

  it("keeps a two-percentage-point hysteresis band while either slider moves", () => {
    expect(setNoteCollapseThreshold(
      { collapseBelowZoom: .4, revealAboveZoom: .45 },
      .6
    )).toEqual({ collapseBelowZoom: .6, revealAboveZoom: .62 })
    expect(setNoteRevealThreshold(
      { collapseBelowZoom: .4, revealAboveZoom: .45 },
      .3
    )).toEqual({ collapseBelowZoom: .28, revealAboveZoom: .3 })
  })

  it("only expands a collapsed note and exits expansion above the reveal point", () => {
    const preview = initialNotePresentationState(longText, 1)
    expect(activateNotePresentation(preview)).toEqual(preview)

    const collapsed = initialNotePresentationState(longText, .35)
    const expanded = activateNotePresentation(collapsed)
    expect(notePresentation(longText, .35, expanded).mode).toBe("expanded")

    const revealed = notePresentation(longText, .7, expanded)
    expect(revealed.mode).toBe("preview")
    expect(revealed.state.expanded).toBe(false)
  })

  it("keeps the preview line measure fixed while canvas zoom changes", () => {
    const atSixtyFivePercent = notePresentation(
      longText,
      .65,
      initialNotePresentationState(longText, .65)
    )
    const atOneHundredPercent = notePresentation(
      longText,
      1,
      initialNotePresentationState(longText, 1)
    )

    expect(atSixtyFivePercent.displayedWidth).toBe(332)
    expect(atOneHundredPercent.displayedWidth).toBe(332)
  })
})
