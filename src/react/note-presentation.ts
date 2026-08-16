export const NOTE_COLLAPSE_BELOW_ZOOM = .5
export const NOTE_REVEAL_ABOVE_ZOOM = .52
export const NOTE_EXPANDED_WIDTH = 420
export const NOTE_COLLAPSED_SIZE = 30
export const NOTE_EXPANDED_MAXIMUM_HEIGHT = 380

export const NOTE_FONT_SIZE = 14
export const NOTE_LINE_HEIGHT = 20
export const NOTE_MINIMUM_LINE_CHARACTERS = 28
export const NOTE_IDEAL_LINE_CHARACTERS = 42

export interface NotePresentationThresholds {
  readonly collapseBelowZoom: number
  readonly revealAboveZoom: number
}

export const DEFAULT_NOTE_PRESENTATION_THRESHOLDS: NotePresentationThresholds = {
  collapseBelowZoom: NOTE_COLLAPSE_BELOW_ZOOM,
  revealAboveZoom: NOTE_REVEAL_ABOVE_ZOOM
}

export const NOTE_MINIMUM_THRESHOLD_GAP = .02

const percentage = (value: number) => Math.round(value * 100) / 100

export const setNoteCollapseThreshold = (
  thresholds: NotePresentationThresholds,
  collapseBelowZoom: number
): NotePresentationThresholds => ({
  collapseBelowZoom,
  revealAboveZoom: percentage(Math.max(
    thresholds.revealAboveZoom,
    collapseBelowZoom + NOTE_MINIMUM_THRESHOLD_GAP
  ))
})

export const setNoteRevealThreshold = (
  thresholds: NotePresentationThresholds,
  revealAboveZoom: number
): NotePresentationThresholds => ({
  collapseBelowZoom: percentage(Math.min(
    thresholds.collapseBelowZoom,
    revealAboveZoom - NOTE_MINIMUM_THRESHOLD_GAP
  )),
  revealAboveZoom
})

const NOTE_AVERAGE_CHARACTER_EM = .52
const NOTE_HORIZONTAL_CHROME = 26

export type NoteAutomaticMode = "preview" | "collapsed"

export interface NotePresentationState {
  readonly automaticMode: NoteAutomaticMode
  readonly expanded: boolean
}

export interface NotePresentation {
  readonly state: NotePresentationState
  readonly mode: NoteAutomaticMode | "expanded"
  readonly intrinsicWidth: number
  readonly displayedWidth: number
  readonly lineCharacters: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export const noteIntrinsicWidth = (text: string) => {
  const longestLineCharacters = Math.max(
    0,
    ...text.split("\n").map((line) => line.trim().length)
  )
  const lineCharacters = clamp(
    longestLineCharacters,
    NOTE_MINIMUM_LINE_CHARACTERS,
    NOTE_IDEAL_LINE_CHARACTERS
  )
  return {
    lineCharacters,
    width: Math.round(
      lineCharacters * NOTE_FONT_SIZE * NOTE_AVERAGE_CHARACTER_EM +
      NOTE_HORIZONTAL_CHROME
    )
  }
}

const automaticMode = (
  previous: NoteAutomaticMode,
  zoom: number,
  thresholds: NotePresentationThresholds
): NoteAutomaticMode => previous === "collapsed"
  ? zoom > thresholds.revealAboveZoom ? "preview" : "collapsed"
  : zoom < thresholds.collapseBelowZoom ? "collapsed" : "preview"

export const initialNotePresentationState = (
  text: string,
  zoom: number,
  expanded = false,
  thresholds = DEFAULT_NOTE_PRESENTATION_THRESHOLDS
): NotePresentationState => {
  const initialMode = zoom < thresholds.collapseBelowZoom
    ? "collapsed"
    : "preview"
  return {
    automaticMode: initialMode,
    expanded: expanded && initialMode === "collapsed"
  }
}

export const notePresentation = (
  text: string,
  zoom: number,
  previous: NotePresentationState,
  thresholds = DEFAULT_NOTE_PRESENTATION_THRESHOLDS
): NotePresentation => {
  const intrinsic = noteIntrinsicWidth(text)
  const nextAutomaticMode = automaticMode(
    previous.automaticMode,
    zoom,
    thresholds
  )
  const expanded = previous.expanded && nextAutomaticMode === "collapsed"
  const mode = expanded ? "expanded" : nextAutomaticMode
  const displayedWidth = mode === "expanded"
    ? NOTE_EXPANDED_WIDTH
    : mode === "collapsed"
      ? NOTE_COLLAPSED_SIZE
      : intrinsic.width
  return {
    state: { automaticMode: nextAutomaticMode, expanded },
    mode,
    intrinsicWidth: intrinsic.width,
    displayedWidth,
    lineCharacters: intrinsic.lineCharacters
  }
}

export const activateNotePresentation = (
  state: NotePresentationState
): NotePresentationState => state.automaticMode === "collapsed"
  ? { ...state, expanded: true }
  : state

export const dismissNotePresentation = (
  state: NotePresentationState
): NotePresentationState => state.expanded
  ? { ...state, expanded: false }
  : state
