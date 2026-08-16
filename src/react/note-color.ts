import type { NoteColorFamily } from "../core/index.js"
import { cssVariableStyle } from "./css-variable-style.js"

export interface NoteColorDefinition {
  readonly family: NoteColorFamily
  readonly label: string
  readonly surface: string
  readonly pure: string
  readonly shade: string
  readonly swatch: string
  readonly ink: string
  readonly text: string
}

const color = (
  family: NoteColorFamily,
  label: string,
  hue: string,
  neutral = false
): NoteColorDefinition => {
  const token = (role: string, fallback: string) => neutral
    ? `var(--crit-color-${role}, ${fallback})`
    : `var(--crit-color-${family}-${role}, ${fallback})`
  return {
    family,
    label,
    surface: token("c1", `oklch(95.25% ${neutral ? "0 none" : `.024 ${hue}`})`),
    pure: token("s1", `oklch(99% ${neutral ? "0 none" : `.003 ${hue}`})`),
    shade: token("p2", `oklch(65% ${neutral ? "0 none" : `.2 ${hue}`})`),
    swatch: token("p1", `oklch(67% ${neutral ? "0 none" : `.18 ${hue}`})`),
    ink: token("t1", `oklch(52% ${neutral ? "0 none" : `.2 ${hue}`})`),
    text: token("t2", `oklch(28% ${neutral ? "0 none" : `.1 ${hue}`})`)
  }
}

export const NOTE_COLOR_DEFINITIONS: ReadonlyArray<NoteColorDefinition> = [
  color("neutral", "Neutral", "none", true),
  color("red", "Red", "9"),
  color("orange", "Orange", "55"),
  color("green", "Green", "156.3"),
  color("blue", "Blue", "245.3"),
  color("purple", "Purple", "302")
]

export const noteColorDefinition = (family: NoteColorFamily) =>
  NOTE_COLOR_DEFINITIONS.find((definition) => definition.family === family)!

export const noteColorStyle = (family: NoteColorFamily) => {
  const definition = noteColorDefinition(family)
  return cssVariableStyle({
    "--crit-note-surface": definition.surface,
    "--crit-note-pure": definition.pure,
    "--crit-note-shade": definition.shade,
    "--crit-note-swatch": definition.swatch,
    "--crit-note-ink": definition.ink,
    "--crit-note-text": definition.text
  })
}
