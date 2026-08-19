export const NOTE_FONT_SIZE = 14
export const NOTE_LINE_HEIGHT = 20
export const NOTE_MINIMUM_ROWS = 3
export const NOTE_PADDING = 12
export const NOTE_BORDER_HEIGHT = 2
export const NOTE_INTERACTION_BAND_HEIGHT = 28.5
export const NOTE_IDEAL_LINE_CHARACTERS = 42
const NOTE_AVERAGE_CHARACTER_EM = .52
const NOTE_HORIZONTAL_CHROME = 26

export const NOTE_TEXTAREA_MIN_HEIGHT =
  NOTE_MINIMUM_ROWS * NOTE_LINE_HEIGHT + NOTE_PADDING
export const NOTE_CARD_WIDTH = Math.round(
  NOTE_IDEAL_LINE_CHARACTERS * NOTE_FONT_SIZE * NOTE_AVERAGE_CHARACTER_EM +
  NOTE_HORIZONTAL_CHROME
)
export const NOTE_CARD_HEIGHT = Math.ceil(
  NOTE_TEXTAREA_MIN_HEIGHT + NOTE_BORDER_HEIGHT + NOTE_INTERACTION_BAND_HEIGHT
)

export interface NotePresentationSize {
  readonly width: number
  readonly height: number
}

export const noteCardHeightForTextarea = (textareaHeight: number) =>
  Math.ceil(
    Math.max(textareaHeight, NOTE_TEXTAREA_MIN_HEIGHT) +
    NOTE_BORDER_HEIGHT +
    NOTE_INTERACTION_BAND_HEIGHT
  )

export const measureNoteTextareaHeight = (editor: {
  readonly scrollHeight: number
  style: { height: string }
}) => {
  const previous = editor.style.height
  editor.style.height = "0px"
  const height = Math.max(NOTE_TEXTAREA_MIN_HEIGHT, editor.scrollHeight)
  editor.style.height = previous
  return height
}

export const notePresentedSize = (
  textareaHeight = NOTE_TEXTAREA_MIN_HEIGHT
): NotePresentationSize => ({
  width: NOTE_CARD_WIDTH,
  height: noteCardHeightForTextarea(textareaHeight)
})

export const notePlacementOrigin = (worldX: number, worldY: number) => ({
  x: worldX - NOTE_CARD_WIDTH / 2,
  y: worldY - NOTE_CARD_HEIGHT / 2
})
