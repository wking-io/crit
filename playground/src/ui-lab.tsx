import { Button } from "@base-ui/react/button"
import { Input } from "@base-ui/react/input"
import { Toast } from "@base-ui/react/toast"
import { Toggle } from "@base-ui/react/toggle"
import { Tooltip } from "@base-ui/react/tooltip"
import {
  DialRoot,
  useDialKit,
  type DialConfig,
  type ResolvedValues,
  type SelectConfig
} from "dialkit"
import { Effect } from "effect"
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react"

import type {
  CanvasCommentThread,
  CanvasFrame,
  CanvasNote,
  Author,
  FrameReviewStatus
} from "../../src/core/index.js"
import {
  CritMenuSpecimen,
  type ContextMenuItem
} from "../../src/react/canvas-context-menu.js"
import { CanvasActionRunnerProvider } from "../../src/react/canvas-action-runner.js"
import { CanvasControls } from "../../src/react/canvas-controls.js"
import { cssVariableStyle } from "../../src/react/css-variable-style.js"
import { CanvasPresenceIndicator, CanvasSaveIndicator, CritBoundaryMessage } from "../../src/react/canvas-feedback.js"
import { actionHelpDetails, CanvasHelpPanel } from "../../src/react/canvas-help.js"
import { CanvasCommentPin } from "../../src/react/canvas-comment-pin.js"
import { CanvasToolbar } from "../../src/react/canvas-toolbar.js"
import { CommentPopover } from "../../src/react/comment-popover.js"
import { critStyles } from "../../src/react/crit-styles.js"
import { FRAME_STATUSES, frameStatus } from "../../src/react/frame-chrome.js"
import { FrameCard } from "../../src/react/frame-card.js"
import { Glyph } from "../../src/react/glyph.js"
import { NewFrameForm } from "../../src/react/new-frame-dialog.js"
import { NoteCard } from "../../src/react/note-card.js"
import {
  CritOverlayProvider,
  useCritOverlayContainer
} from "../../src/react/overlay-container.js"

import "dialkit/styles.css"
import "./base-tokens.css"
import "./ui-lab.css"

const TOKEN_STEPS = [
  "s1", "s2", "c1", "c2", "c3", "p1", "p2", "t1", "t2"
] as const

type TokenStep = (typeof TOKEN_STEPS)[number]
type PaletteName = "neutral" | "orange" | "blue" | "green" | "purple" | "red"
type ChromaticPalette = Exclude<PaletteName, "neutral">
type TokenName =
  | "--crit-color-s1"
  | "--crit-color-s2"
  | "--crit-color-c1"
  | "--crit-color-c2"
  | "--crit-color-c3"
  | "--crit-color-p1"
  | "--crit-color-p2"
  | "--crit-color-t1"
  | "--crit-color-t2"
  | `--crit-color-${Exclude<PaletteName, "neutral">}-${TokenStep}`

type TokenValues = ReadonlyMap<TokenName, string>

type ColorColumnDefault = {
  readonly lightness: number
  readonly chroma: number
}

const COLUMN_DEFAULTS = {
  s1: { lightness: 99, chroma: 0.003 },
  s2: { lightness: 97.5, chroma: 0.009 },
  c1: { lightness: 95.25, chroma: 0.024 },
  c2: { lightness: 94, chroma: 0.028 },
  c3: { lightness: 92.75, chroma: 0.036 },
  p1: { lightness: 67, chroma: 0.18 },
  p2: { lightness: 65, chroma: 0.2 },
  t1: { lightness: 52, chroma: 0.2 },
  t2: { lightness: 28, chroma: 0.1 }
} as const satisfies Readonly<Record<TokenStep, ColorColumnDefault>>

const HUE_DEFAULTS = {
  red: 9,
  orange: 55,
  blue: 245.3,
  green: 156.3,
  purple: 302
} as const satisfies Readonly<Record<ChromaticPalette, number>>

const slider = (
  value: number,
  min: number,
  max: number,
  step: number
): [number, number, number, number] => [value, min, max, step]

const tokenName = (palette: PaletteName, step: TokenStep): TokenName => {
  if (palette === "neutral") return `--crit-color-${step}`
  return `--crit-color-${palette}-${step}`
}

const BASE_PALETTES: ReadonlyArray<{
  readonly id: PaletteName
  readonly label: string
}> = [
  { id: "neutral", label: "Neutral · Archived" },
  { id: "red", label: "Red · Destructive" },
  { id: "orange", label: "Orange · Changes" },
  { id: "blue", label: "Blue · Progress" },
  { id: "green", label: "Green · Approved" },
  { id: "purple", label: "Purple · Review" }
]

const BASE_TOKENS: ReadonlyArray<{
  readonly name: TokenName
  readonly shortName: TokenStep
  readonly palette: PaletteName
}> = BASE_PALETTES.flatMap(({ id }) =>
  TOKEN_STEPS.map((shortName) => ({
    name: tokenName(id, shortName),
    shortName,
    palette: id
  }))
)

const TOKEN_OPTIONS = BASE_TOKENS.map(({ name, palette, shortName }) => ({
  value: name,
  label: `${palette} · ${shortName}`
}))

const TOKEN_NAMES = new Set<string>(BASE_TOKENS.map(({ name }) => name))
const isTokenName = (value: string): value is TokenName =>
  TOKEN_NAMES.has(value)

const tokenSelect = (defaultValue: TokenName): SelectConfig => ({
  type: "select",
  options: TOKEN_OPTIONS,
  default: defaultValue
})

const BASE_SCALE_CONFIG = {
  greyscale: false,
  hues: {
    _collapsed: true,
    red: slider(HUE_DEFAULTS.red, 0, 360, 0.1),
    orange: slider(HUE_DEFAULTS.orange, 0, 360, 0.1),
    blue: slider(HUE_DEFAULTS.blue, 0, 360, 0.1),
    green: slider(HUE_DEFAULTS.green, 0, 360, 0.1),
    purple: slider(HUE_DEFAULTS.purple, 0, 360, 0.1)
  },
  s1: {
    _collapsed: true,
    lightness: slider(COLUMN_DEFAULTS.s1.lightness, 0, 100, 0.25),
    chroma: slider(COLUMN_DEFAULTS.s1.chroma, 0, 0.3, 0.001)
  },
  s2: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.s2.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.s2.chroma, 0, 0.3, 0.001) },
  c1: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.c1.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.c1.chroma, 0, 0.3, 0.001) },
  c2: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.c2.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.c2.chroma, 0, 0.3, 0.001) },
  c3: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.c3.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.c3.chroma, 0, 0.3, 0.001) },
  p1: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.p1.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.p1.chroma, 0, 0.3, 0.001) },
  p2: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.p2.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.p2.chroma, 0, 0.3, 0.001) },
  t1: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.t1.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.t1.chroma, 0, 0.3, 0.001) },
  t2: { _collapsed: true, lightness: slider(COLUMN_DEFAULTS.t2.lightness, 0, 100, 0.25), chroma: slider(COLUMN_DEFAULTS.t2.chroma, 0, 0.3, 0.001) }
}

// One base-scale assignment study, switchable live through DialKit at /ui.
const RECIPE_CONFIG = {
  baseScale: BASE_SCALE_CONFIG,
  page: {
    _collapsed: true,
    sectionBorder: tokenSelect("--crit-color-c3"),
    text: tokenSelect("--crit-color-t2"),
    mutedText: tokenSelect("--crit-color-t1")
  },
  toolbar: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-s2"),
    border: tokenSelect("--crit-color-c3"),
    text: tokenSelect("--crit-color-t2"),
    divider: tokenSelect("--crit-color-c3"),
    button: {
      background: tokenSelect("--crit-color-s2"),
      hoverBackground: tokenSelect("--crit-color-c2"),
      pressedBackground: tokenSelect("--crit-color-c1"),
      foreground: tokenSelect("--crit-color-t2"),
      disabledForeground: tokenSelect("--crit-color-p1"),
      focusRing: tokenSelect("--crit-color-p2")
    }
  },
  statusMenu: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-c1"),
    border: tokenSelect("--crit-color-c3"),
    text: tokenSelect("--crit-color-t2"),
    hoverSurface: tokenSelect("--crit-color-c2"),
    selectedBorder: tokenSelect("--crit-color-p2"),
    disabledText: tokenSelect("--crit-color-p1")
  },
  help: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-s2"),
    border: tokenSelect("--crit-color-c3"),
    title: tokenSelect("--crit-color-t2"),
    description: tokenSelect("--crit-color-t1"),
    shortcutSurface: tokenSelect("--crit-color-c1"),
    shortcutText: tokenSelect("--crit-color-t1"),
    shortcutBorder: tokenSelect("--crit-color-c3")
  },
  presence: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-t2"),
    text: tokenSelect("--crit-color-s1"),
    dot: tokenSelect("--crit-color-c1"),
    saveSurface: tokenSelect("--crit-color-t1"),
    saveText: tokenSelect("--crit-color-s1"),
    conflictSurface: tokenSelect("--crit-color-p2"),
    conflictText: tokenSelect("--crit-color-s1")
  },
  menu: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-s2"),
    border: tokenSelect("--crit-color-c3"),
    text: tokenSelect("--crit-color-t2"),
    detailText: tokenSelect("--crit-color-t1"),
    hoverSurface: tokenSelect("--crit-color-c2"),
    focusRing: tokenSelect("--crit-color-p2"),
    dangerText: tokenSelect("--crit-color-red-t1")
  },
  dialog: {
    _collapsed: true,
    backdrop: tokenSelect("--crit-color-p1"),
    surface: tokenSelect("--crit-color-s1"),
    border: tokenSelect("--crit-color-c3"),
    text: tokenSelect("--crit-color-t2"),
    mutedText: tokenSelect("--crit-color-t1"),
    inputSurface: tokenSelect("--crit-color-s1"),
    inputBorder: tokenSelect("--crit-color-c3"),
    focusRing: tokenSelect("--crit-color-p2"),
    buttonSurface: tokenSelect("--crit-color-c1"),
    buttonHoverSurface: tokenSelect("--crit-color-c2"),
    primarySurface: tokenSelect("--crit-color-t2"),
    primaryText: tokenSelect("--crit-color-s1"),
    disabledSurface: tokenSelect("--crit-color-c3"),
    disabledText: tokenSelect("--crit-color-p1")
  },
  comment: {
    _collapsed: true,
    pinSurface: tokenSelect("--crit-color-s1"),
    pinBorder: tokenSelect("--crit-color-p2"),
    surface: tokenSelect("--crit-color-s2"),
    border: tokenSelect("--crit-color-c3"),
    text: tokenSelect("--crit-color-t2"),
    mutedText: tokenSelect("--crit-color-t1"),
    separator: tokenSelect("--crit-color-c3"),
    inputSurface: tokenSelect("--crit-color-s1"),
    inputBorder: tokenSelect("--crit-color-c3"),
    actionSurface: tokenSelect("--crit-color-t2"),
    actionText: tokenSelect("--crit-color-s1"),
    hoverSurface: tokenSelect("--crit-color-c2"),
    disabledText: tokenSelect("--crit-color-p1")
  },
  message: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-s2"),
    text: tokenSelect("--crit-color-t1"),
    errorSurface: tokenSelect("--crit-color-red-c1"),
    errorText: tokenSelect("--crit-color-red-t1"),
    emptySurface: tokenSelect("--crit-color-s1"),
    emptyBorder: tokenSelect("--crit-color-c3")
  }
} satisfies DialConfig

type Assignment = {
  readonly token: TokenName
  readonly variable: `--ui-${string}`
}

type RecipeValues = ResolvedValues<typeof RECIPE_CONFIG>

const RECIPE_SELECTOR_COUNT =
  JSON.stringify(RECIPE_CONFIG).match(/"type":"select"/g)?.length ?? 0

const assignment = (
  variable: Assignment["variable"],
  value: string
): Assignment => {
  if (!isTokenName(value)) {
    throw new TypeError(`Unknown UI lab token assignment ${value}`)
  }
  return { token: value, variable }
}

const explicitAssignmentsFor = (
  values: RecipeValues
): ReadonlyArray<Assignment> => [
  assignment("--ui-page-section-border", values.page.sectionBorder),
  assignment("--ui-page-text", values.page.text),
  assignment("--ui-page-muted-text", values.page.mutedText),
  assignment("--ui-toolbar-surface", values.toolbar.surface),
  assignment("--ui-toolbar-border", values.toolbar.border),
  assignment("--ui-toolbar-text", values.toolbar.text),
  assignment("--ui-toolbar-divider", values.toolbar.divider),
  assignment("--ui-toolbar-button-background", values.toolbar.button.background),
  assignment("--ui-toolbar-button-hover-background", values.toolbar.button.hoverBackground),
  assignment("--ui-toolbar-button-pressed-background", values.toolbar.button.pressedBackground),
  assignment("--ui-toolbar-button-foreground", values.toolbar.button.foreground),
  assignment("--ui-toolbar-button-disabled-foreground", values.toolbar.button.disabledForeground),
  assignment("--ui-toolbar-button-focus-ring", values.toolbar.button.focusRing),
  assignment("--ui-status-menu-surface", values.statusMenu.surface),
  assignment("--ui-status-menu-border", values.statusMenu.border),
  assignment("--ui-status-menu-text", values.statusMenu.text),
  assignment("--ui-status-menu-hover-surface", values.statusMenu.hoverSurface),
  assignment("--ui-status-menu-selected-border", values.statusMenu.selectedBorder),
  assignment("--ui-status-menu-disabled-text", values.statusMenu.disabledText),
  assignment("--ui-help-surface", values.help.surface),
  assignment("--ui-help-border", values.help.border),
  assignment("--ui-help-title", values.help.title),
  assignment("--ui-help-description", values.help.description),
  assignment("--ui-help-shortcut-surface", values.help.shortcutSurface),
  assignment("--ui-help-shortcut-text", values.help.shortcutText),
  assignment("--ui-help-shortcut-border", values.help.shortcutBorder),
  assignment("--ui-presence-surface", values.presence.surface),
  assignment("--ui-presence-text", values.presence.text),
  assignment("--ui-presence-dot", values.presence.dot),
  assignment("--ui-presence-save-surface", values.presence.saveSurface),
  assignment("--ui-presence-save-text", values.presence.saveText),
  assignment("--ui-presence-conflict-surface", values.presence.conflictSurface),
  assignment("--ui-presence-conflict-text", values.presence.conflictText),
  assignment("--ui-menu-surface", values.menu.surface),
  assignment("--ui-menu-border", values.menu.border),
  assignment("--ui-menu-text", values.menu.text),
  assignment("--ui-menu-detail-text", values.menu.detailText),
  assignment("--ui-menu-hover-surface", values.menu.hoverSurface),
  assignment("--ui-menu-focus-ring", values.menu.focusRing),
  assignment("--ui-menu-danger-text", values.menu.dangerText),
  assignment("--ui-dialog-backdrop", values.dialog.backdrop),
  assignment("--ui-dialog-surface", values.dialog.surface),
  assignment("--ui-dialog-border", values.dialog.border),
  assignment("--ui-dialog-text", values.dialog.text),
  assignment("--ui-dialog-muted-text", values.dialog.mutedText),
  assignment("--ui-dialog-input-surface", values.dialog.inputSurface),
  assignment("--ui-dialog-input-border", values.dialog.inputBorder),
  assignment("--ui-dialog-focus-ring", values.dialog.focusRing),
  assignment("--ui-dialog-button-surface", values.dialog.buttonSurface),
  assignment("--ui-dialog-button-hover-surface", values.dialog.buttonHoverSurface),
  assignment("--ui-dialog-primary-surface", values.dialog.primarySurface),
  assignment("--ui-dialog-primary-text", values.dialog.primaryText),
  assignment("--ui-dialog-disabled-surface", values.dialog.disabledSurface),
  assignment("--ui-dialog-disabled-text", values.dialog.disabledText),
  assignment("--ui-comment-pin-surface", values.comment.pinSurface),
  assignment("--ui-comment-pin-border", values.comment.pinBorder),
  assignment("--ui-comment-surface", values.comment.surface),
  assignment("--ui-comment-border", values.comment.border),
  assignment("--ui-comment-text", values.comment.text),
  assignment("--ui-comment-muted-text", values.comment.mutedText),
  assignment("--ui-comment-separator", values.comment.separator),
  assignment("--ui-comment-input-surface", values.comment.inputSurface),
  assignment("--ui-comment-input-border", values.comment.inputBorder),
  assignment("--ui-comment-action-surface", values.comment.actionSurface),
  assignment("--ui-comment-action-text", values.comment.actionText),
  assignment("--ui-comment-hover-surface", values.comment.hoverSurface),
  assignment("--ui-comment-disabled-text", values.comment.disabledText),
  assignment("--ui-message-surface", values.message.surface),
  assignment("--ui-message-text", values.message.text),
  assignment("--ui-message-error-surface", values.message.errorSurface),
  assignment("--ui-message-error-text", values.message.errorText),
  assignment("--ui-message-empty-surface", values.message.emptySurface),
  assignment("--ui-message-empty-border", values.message.emptyBorder)
]

const assignmentsFor = (values: RecipeValues): ReadonlyArray<Assignment> => {
  const assignments = explicitAssignmentsFor(values)
  if (assignments.length !== RECIPE_SELECTOR_COUNT) {
    throw new TypeError(
      "Every Crit UI color selector requires one explicit CSS assignment"
    )
  }
  return assignments
}

function SpecimenSection({
  children,
  id,
  title
}: {
  readonly children: ReactNode
  readonly id: string
  readonly title: string
}) {
  return (
    <section className="ui-specimen-section" data-section={id} id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function StateLabel({ children }: { readonly children: ReactNode }) {
  return <span className="ui-state-label">{children}</span>
}

export const oklchToHex = (color: string) => {
  const match = color.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+(none|[-\d.]+)\)$/)
  if (match === null) return color
  const lightness = Number(match[1]) / 100
  const chroma = Number(match[2])
  const hue = match[3] === "none" ? 0 : Number(match[3])
  const radians = hue * Math.PI / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
  const channel = (value: number) => {
    const encoded = value <= 0.0031308
      ? 12.92 * value
      : 1.055 * value ** (1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${linear.map(channel).join("")}`
}

function ColorCopyToasts() {
  const { toasts } = Toast.useToastManager()
  const overlayContainer = useCritOverlayContainer()
  return (
    <Toast.Portal container={overlayContainer}>
      <Toast.Viewport className="ui-color-toast-viewport">
        {toasts.map((toast) => (
          <Toast.Positioner
            className="ui-color-toast-positioner"
            key={toast.id}
            toast={toast}
          >
            <Toast.Root className="ui-color-toast" toast={toast}>
              <Toast.Content>
                <Toast.Description className="ui-color-toast__description" />
              </Toast.Content>
            </Toast.Root>
          </Toast.Positioner>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

function ColorScaleContent({ values }: { readonly values: TokenValues }) {
  const [shiftHeld, setShiftHeld] = useState(false)
  const toastManager = Toast.useToastManager()
  const overlayContainer = useCritOverlayContainer()
  useEffect(() => {
    const update = (event: KeyboardEvent) => setShiftHeld(event.shiftKey)
    const reset = () => setShiftHeld(false)
    window.addEventListener("keydown", update)
    window.addEventListener("keyup", update)
    window.addEventListener("blur", reset)
    return () => {
      window.removeEventListener("keydown", update)
      window.removeEventListener("keyup", update)
      window.removeEventListener("blur", reset)
    }
  }, [])
  const confirmCopy = (anchor: Element) => {
    toastManager.add({
      description: "copied",
      id: "ui-color-copy",
      positionerProps: { anchor, sideOffset: 7 }
    })
  }
  const copyColor = (color: string, anchor: Element) => {
    const previousFocus = document.activeElement
    const textarea = document.createElement("textarea")
    textarea.value = color
    textarea.readOnly = true
    textarea.style.position = "fixed"
    textarea.style.inset = "-1000px auto auto -1000px"
    document.body.append(textarea)
    textarea.select()
    let copied = false
    try {
      copied = document.execCommand("copy")
    } catch {
      copied = false
    }
    textarea.remove()
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
    if (copied) {
      confirmCopy(anchor)
      return
    }
    if (navigator.clipboard === undefined) {
      return
    }
    void navigator.clipboard.writeText(color).then(() => {
      confirmCopy(anchor)
    }).catch(() => undefined)
  }

  return (
    <SpecimenSection id="01" title="Base color scale">
      <div className="ui-palette-table">
        {BASE_PALETTES.map((palette) => (
          <div className="ui-palette-row" key={palette.id}>
            <span className="ui-palette-row__label">{palette.label}</span>
            <ol aria-label={`${palette.label} base color tokens`} className="ui-scale">
              {BASE_TOKENS.filter((token) => token.palette === palette.id).map((token, index) => {
                const oklch = values.get(token.name)
                if (oklch === undefined) {
                  throw new TypeError(`Missing UI lab token ${token.name}`)
                }
                const displayedColor = shiftHeld ? oklchToHex(oklch) : oklch
                return <li
                  className="ui-scale__token"
                  key={token.name}
                  style={cssVariableStyle({
                    "--ui-scale-color": `var(${token.name})`,
                    "--ui-scale-ink": index < 5
                      ? "var(--crit-color-t2)"
                      : "var(--crit-color-s1)"
                  })}
                >
                  <Tooltip.Root>
                    <Tooltip.Trigger
                      aria-label={`Copy ${displayedColor}`}
                      className="ui-scale__copy"
                      onClick={(event) => copyColor(displayedColor, event.currentTarget)}
                      render={<Button type="button" />}
                    >
                      <strong>{token.shortName}</strong>
                    </Tooltip.Trigger>
                    <Tooltip.Portal container={overlayContainer}>
                      <Tooltip.Positioner
                        className="ui-tooltip-positioner"
                        sideOffset={7}
                      >
                        <Tooltip.Popup className="ui-tooltip">
                          {displayedColor}
                        </Tooltip.Popup>
                      </Tooltip.Positioner>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </li>
              })}
            </ol>
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}

function ColorScale({ values }: { readonly values: TokenValues }) {
  return (
    <Tooltip.Provider closeDelay={0} delay={0}>
      <Toast.Provider limit={1} timeout={1200}>
        <ColorScaleContent values={values} />
        <ColorCopyToasts />
      </Toast.Provider>
    </Tooltip.Provider>
  )
}

const TOOLBAR_BUTTON_STATES: ReadonlyArray<{
  readonly icon: "pointer" | "pan" | "addFrame" | "comment" | "undo"
  readonly label: string
  readonly state: "default" | "hover" | "focus" | "pressed" | "disabled"
  readonly toggle: boolean
}> = [
  { icon: "pointer", label: "Default", state: "default", toggle: true },
  { icon: "pan", label: "Hover", state: "hover", toggle: true },
  { icon: "addFrame", label: "Focus", state: "focus", toggle: false },
  { icon: "comment", label: "Pressed", state: "pressed", toggle: true },
  { icon: "undo", label: "Unavailable", state: "disabled", toggle: false }
]

function ToolbarSpecimens() {
  return (
    <SpecimenSection id="02" title="Canvas toolbar">
      <div className="ui-toolbar-stage">
        <CanvasToolbar
          commentAvailable
          noteAvailable
          onAction={() => {}}
          title="Feature lab"
          tool="select"
        />
      </div>
      <div className="ui-state-grid ui-state-grid--buttons">
        {TOOLBAR_BUTTON_STATES.map(({ icon, label, state, toggle }) => (
          <div className="ui-state-cell" key={state}>
            <StateLabel>{label}</StateLabel>
            {toggle ? (
              <Toggle
                aria-disabled={state === "disabled" || undefined}
                className="crit-icon-button ui-toolbar-button--large"
                data-state={state}
                pressed={state === "pressed"}
              ><Glyph name={icon} /></Toggle>
            ) : (
              <Button
                aria-disabled={state === "disabled" || undefined}
                className="crit-icon-button ui-toolbar-button--large"
                data-state={state}
                type="button"
              ><Glyph name={icon} /></Button>
            )}
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}

function FrameSpecimen({
  defaultStatusMenuOpen = false,
  mode = "full",
  selected = false,
  state = "loaded",
  status
}: {
  readonly defaultStatusMenuOpen?: boolean
  readonly mode?: "full" | "compact" | "minimal"
  readonly selected?: boolean
  readonly state?: "loaded" | "editing" | "snapshotting" | "paused" | "fullscreen"
  readonly status: (typeof FRAME_STATUSES)[number]
}) {
  const width = mode === "full" ? 330 : mode === "compact" ? 170 : 90
  const geometry = {
    x: defaultStatusMenuOpen ? 190 : 12,
    y: defaultStatusMenuOpen ? 220 : 42,
    width,
    height: 176
  }
  const frame: CanvasFrame = {
    id: `lab-${status.id}-${mode}-${state}`,
    url: "about:blank",
    title: state === "snapshotting" ? "Checkout candidate · Snapshotting" : "Checkout candidate",
    status: status.id,
    provenance: { kind: "manual", sourceId: "ui-lab" },
    display: { heightMode: "viewport" },
    geometry,
    zIndex: 1
  }
  return (
    <div
      className="crit-canvas ui-production-canvas ui-frame-stage"
      data-mode={mode}
      data-selected={selected || undefined}
      data-state={state}
      data-status-menu={defaultStatusMenuOpen || undefined}
      style={{
        width: defaultStatusMenuOpen ? width + 214 : width + 24
      }}
    >
      <FrameCard
        commentMode={false}
        commentThreads={[]}
        defaultStatusMenuOpen={defaultStatusMenuOpen}
        frame={frame}
        geometry={geometry}
        iframeAllow=""
        iframeVisible={state !== "paused"}
        onBringToFront={() => Effect.void}
        onCommentAnchor={() => Effect.void}
        onCompleteBreakpoints={() => Effect.void}
        onDuplicateAt={() => Effect.void}
        onFitContent={() => Effect.void}
        onInputIntent={() => {}}
        onMove={() => {}}
        onOpenComment={() => Effect.void}
        onRemove={() => Effect.void}
        onResize={() => {}}
        onSelect={() => {}}
        onSendToBack={() => Effect.void}
        onSetSize={() => Effect.void}
        onSnapshot={() => Effect.succeed(undefined)}
        onSnapshotError={() => {}}
        onStatus={() => Effect.void}
        onTitle={() => Effect.void}
        selected={selected}
        shortId="A"
        topZIndex={2}
        zoom={1}
      />
    </div>
  )
}

function FramesSpecimens() {
  const inProgress = FRAME_STATUSES.find(({ id }) => id === "in-progress")!
  return (
    <SpecimenSection id="03" title="Frames and status">
      <h3 className="ui-subsection-heading">Frame statuses</h3>
      <div className="ui-frame-grid">
        {FRAME_STATUSES.map((status, index) => (
          <div className="ui-frame-cell" key={status.id}>
            <StateLabel>{status.label}</StateLabel>
            <FrameSpecimen selected={index === 1} status={status} />
          </div>
        ))}
      </div>

      <h3 className="ui-subsection-heading">Chrome and viewport states</h3>
      <div className="ui-frame-grid ui-frame-grid--states">
        {([
          ["Full", "full", "loaded"],
          ["Compact", "compact", "loaded"],
          ["Minimal", "minimal", "loaded"],
          ["Title editing", "full", "editing"],
          ["Snapshotting", "full", "snapshotting"],
          ["Paused", "full", "paused"],
          ["Fullscreen", "full", "fullscreen"]
        ] as const).map(([label, mode, state]) => (
          <div className="ui-frame-cell" key={label}>
            <StateLabel>{label}</StateLabel>
            <FrameSpecimen mode={mode} state={state} status={inProgress} />
          </div>
        ))}
      </div>

      <h3 className="ui-subsection-heading">Status menu</h3>
      <div className="ui-status-fan-specimen">
        <StateLabel>Open · In progress</StateLabel>
        <FrameSpecimen defaultStatusMenuOpen status={inProgress} />
      </div>
    </SpecimenSection>
  )
}

function NoteSpecimen({
  attached = false,
  empty = false,
  selected = false
}: {
  readonly attached?: boolean
  readonly empty?: boolean
  readonly selected?: boolean
}) {
  const geometry = { x: 10, y: 34, width: 240, height: 150 }
  const note: CanvasNote = {
    id: `lab-note-${attached}-${empty}`,
    text: empty ? "" : "Tighten the hierarchy around the primary action before review.",
    author: { id: "wes", name: "Wes King" },
    geometry,
    attachedTo: attached ? "Checkout candidate" : null,
    zIndex: 1,
    color: "blue"
  }
  return (
    <div className="crit-canvas ui-production-canvas ui-note-stage">
      <NoteCard
        author={{ id: "wes", name: "Wes King" }}
        commit={() => {}}
        execute={() => Effect.void}
        geometry={geometry}
        note={note}
        onBringToFront={() => Effect.void}
        onMove={() => {}}
        onSelect={() => {}}
        onSendToBack={() => Effect.void}
        selected={selected}
        zoom={1}
      />
    </div>
  )
}

function NotesSpecimens() {
  return (
    <SpecimenSection id="04" title="Notes and selection">
      <div className="ui-note-grid">
        <div><StateLabel>Free · unselected</StateLabel><NoteSpecimen /></div>
        <div><StateLabel>Attached · selected</StateLabel><NoteSpecimen attached selected /></div>
        <div><StateLabel>Empty</StateLabel><NoteSpecimen empty /></div>
      </div>
    </SpecimenSection>
  )
}

function FeedbackSpecimens() {
  return (
    <SpecimenSection id="05" title="Help, presence, and save state">
      <div className="ui-feedback-grid">
        <div><StateLabel>Help · hotkey</StateLabel><CanvasHelpPanel details={actionHelpDetails(LAB_CONTROLS.action({ id: "open-new-frame" }))} /></div>
        <div><StateLabel>Help · no hotkey / long copy</StateLabel><CanvasHelpPanel details={{ _tag: "informational", name: "Resize Checkout candidate", description: "Drag this handle to resize the frame while preserving its opposite edge and minimum dimensions." }} /></div>
        <div className="ui-feedback-badges">
          <StateLabel>Agent presence</StateLabel>
          <CanvasPresenceIndicator
            presence={{
              currentAuthor: { id: "git:ui-lab", name: "Willa King" },
              availability: "available",
              activities: [{
                schemaVersion: 1,
                canvasId: "feature-lab",
                activityId: "codex-thread",
                harness: "Codex",
                model: "GPT-5",
                detail: "arranging frames",
                reference: null,
                createdAt: "2026-08-11T12:00:00.000Z",
                updatedAt: "2026-08-11T12:00:20.000Z",
                activeUntil: "2026-08-11T12:01:20.000Z"
              }]
            }}
          />
          <CanvasPresenceIndicator
            presence={{
              currentAuthor: { id: "git:ui-lab", name: "Willa King" },
              availability: "unavailable",
              activities: []
            }}
          />
        </div>
        <div className="ui-feedback-badges">
          <StateLabel>Save lifecycle</StateLabel>
          {(["clean", "dirty", "saving", "save-error", "conflict"] as const).map((saveStatus) => (
            <CanvasSaveIndicator
              key={saveStatus}
              onDiscardLocalChanges={() => {}}
              recoveryStatus="unavailable"
              saveStatus={saveStatus}
            />
          ))}
          <CanvasSaveIndicator onDiscardLocalChanges={() => {}} recoveryStatus="recovered" saveStatus="clean" />
        </div>
      </div>
    </SpecimenSection>
  )
}

const LAB_CONTROLS = CanvasControls.resolve({
  platform: "macos",
  activeScopes: ["canvas", "menu"],
  globalFacts: { commentAuthorPresent: true },
  pendingActions: []
})
const LAB_FRAME_TARGET = { kind: "frame" as const, id: "lab", label: "Checkout candidate" }
const LAB_FRAME_PRESETS = [
  { preset: "mobile", detail: "402 × 874" },
  { preset: "tablet", detail: "832 × 1194" },
  { preset: "laptop", detail: "1280 × 832" },
  { preset: "desktop", detail: "1512 × 982" },
  { preset: "widescreen", detail: "2560 × 1440" }
] satisfies ReadonlyArray<{
  readonly preset: "mobile" | "tablet" | "laptop" | "desktop" | "widescreen"
  readonly detail: string
}>
const FRAME_MENU_ITEMS: ReadonlyArray<ContextMenuItem> = [
  { action: LAB_CONTROLS.action({ id: "open-frame-new-tab", target: LAB_FRAME_TARGET }), href: "about:blank", detail: <Glyph name="externalArrow" /> },
  { action: LAB_CONTROLS.action({ id: "fit-frame-content", target: LAB_FRAME_TARGET }), execute: Effect.void, detail: "F" },
  {
    action: LAB_CONTROLS.action({ id: "open-frame-size-menu", target: LAB_FRAME_TARGET }),
    items: LAB_FRAME_PRESETS.map(({ preset, detail }) => ({
      action: LAB_CONTROLS.action({ id: "resize-frame-to-preset", target: LAB_FRAME_TARGET, preset }),
      execute: Effect.void,
      detail
    }))
  },
  { action: LAB_CONTROLS.action({ id: "bring-item-to-front", target: LAB_FRAME_TARGET }), execute: Effect.void },
  { action: LAB_CONTROLS.action({ id: "remove-item", target: LAB_FRAME_TARGET }), execute: Effect.void }
]

const EMPTY_MENU_ITEMS: ReadonlyArray<ContextMenuItem> = [
  { action: LAB_CONTROLS.action({ id: "open-new-frame" }), execute: Effect.void },
  { action: LAB_CONTROLS.action({ id: "create-note" }), execute: Effect.void },
  { action: LAB_CONTROLS.action({ id: "zoom-to-fit" }), execute: Effect.void }
]

function ContextMenuSpecimen({ ariaLabel, items }: {
  readonly ariaLabel: string
  readonly items: ReadonlyArray<ContextMenuItem>
}) {
  return (
    <CritMenuSpecimen
      ariaLabel={ariaLabel}
      items={items}
    />
  )
}

function MenuSpecimens() {
  return (
    <SpecimenSection id="06" title="Context menus">
      <div className="ui-menu-grid">
        <div><StateLabel>Frame menu · hover Set size for submenu</StateLabel><ContextMenuSpecimen ariaLabel="Frame menu specimen" items={FRAME_MENU_ITEMS} /></div>
        <div><StateLabel>Empty canvas menu</StateLabel><ContextMenuSpecimen ariaLabel="Canvas menu specimen" items={EMPTY_MENU_ITEMS} /></div>
      </div>
    </SpecimenSection>
  )
}

function ButtonState({
  children,
  primary = false,
  state = "default"
}: {
  readonly children: ReactNode
  readonly primary?: boolean
  readonly state?: "default" | "hover" | "focus" | "pressed" | "disabled"
}) {
  return <span className="crit-new-frame-dialog__actions"><Button data-primary={primary ? "" : undefined} data-state={state} disabled={state === "disabled"} type="button">{children}</Button></span>
}

function DialogSpecimens() {
  return (
    <SpecimenSection id="07" title="Dialog and form controls">
      <div className="ui-dialog-stage">
        <NewFrameForm onCancel={() => {}} onCreate={() => Effect.void} onError={() => {}} />
      </div>
      <div className="crit-new-frame-dialog ui-form-state-grid">
        <label><StateLabel>Empty</StateLabel><Input placeholder="https://example.com/iteration" /></label>
        <label><StateLabel>Populated</StateLabel><Input defaultValue="Checkout candidate" /></label>
        <label><StateLabel>Focused</StateLabel><Input className="is-focus" defaultValue="Checkout candidate" /></label>
        <label><StateLabel>Disabled</StateLabel><Input defaultValue="Unavailable" disabled /></label>
      </div>
      <div className="crit-new-frame-dialog ui-button-state-grid">
        <div><StateLabel>Default</StateLabel><ButtonState>Cancel</ButtonState></div>
        <div><StateLabel>Hover</StateLabel><ButtonState state="hover">Cancel</ButtonState></div>
        <div><StateLabel>Focus</StateLabel><ButtonState state="focus">Cancel</ButtonState></div>
        <div><StateLabel>Pressed</StateLabel><ButtonState state="pressed">Cancel</ButtonState></div>
        <div><StateLabel>Primary</StateLabel><ButtonState primary>Add frame</ButtonState></div>
        <div><StateLabel>Disabled</StateLabel><ButtonState state="disabled">Add frame</ButtonState></div>
      </div>
    </SpecimenSection>
  )
}

function CommentPinSpecimen({ active = false, label, color }: { readonly active?: boolean; readonly label: string; readonly color: string }) {
  return <span aria-label={label} className="ui-comment-pin-stage">
    <CanvasCommentPin active={active} authorName={label} color={color} onOpen={() => Effect.void} threadId="lab-thread" xRatio={0.5} yRatio={0.8} zoom={1} />
  </span>
}

function CommentSpecimens() {
  const owner: Author = { id: "wes", name: "Wes King" }
  const collaborator: Author = { id: "alex", name: "Alex Morgan" }
  const thread: CanvasCommentThread = {
    id: "lab-thread",
    frameId: "lab-frame",
    anchor: { kind: "frame", xRatio: 0.68, yRatio: 0.42 },
    opening: {
      id: "lab-opening",
      body: "Increase the spacing above the checkout summary.",
      author: owner,
      createdAt: "2026-08-09T12:00:00.000Z",
      editedAt: null
    },
    replies: [{
      id: "lab-reply",
      body: "The total is clear now. I would keep this hierarchy.",
      author: collaborator,
      createdAt: "2026-08-09T12:05:00.000Z",
      editedAt: "2026-08-09T12:06:00.000Z"
    }],
    resolvedAt: null,
    resolvedBy: null
  }
  const color = frameStatus("ready-for-review").ink
  return (
    <SpecimenSection id="08" title="Comments">
      <div className="ui-comment-pin-row">
        {FRAME_STATUSES.map((status) => (
          <div key={status.id}><StateLabel>{status.label}</StateLabel><CommentPinSpecimen color={status.ink} label={`${status.label} comment pin`} /></div>
        ))}
        <div><StateLabel>Open thread · dot</StateLabel><CommentPinSpecimen active color={color} label="Open comment thread" /></div>
      </div>
      <div className="ui-comment-grid">
        <div><StateLabel>New · empty submit disabled</StateLabel><CommentPopover canSubmit clearDraft={null} currentAuthorId="wes" frameId="candidate" inline pending={false} statusColor={color} threadManageable={false} onClose={() => Effect.void} onDraftStatus={() => {}} onEdit={() => Effect.void} onResolve={() => Effect.void} onSubmit={() => Effect.void} /></div>
        <div><StateLabel>Thread · owner can resolve</StateLabel><CommentPopover canSubmit clearDraft={null} currentAuthorId={thread.opening.author.id} frameId="candidate" inline pending={false} statusColor={color} thread={thread} threadManageable onClose={() => Effect.void} onDraftStatus={() => {}} onEdit={() => Effect.void} onResolve={() => Effect.void} onSubmit={() => Effect.void} /></div>
        <div><StateLabel>Thread · no resolve permission</StateLabel><CommentPopover canSubmit clearDraft={null} currentAuthorId={null} frameId="candidate" inline pending={false} statusColor={color} thread={thread} threadManageable={false} onClose={() => Effect.void} onDraftStatus={() => {}} onEdit={() => Effect.void} onResolve={() => Effect.void} onSubmit={() => Effect.void} /></div>
      </div>
    </SpecimenSection>
  )
}

function MessageSpecimens() {
  return (
    <SpecimenSection id="09" title="Loading and error states">
      <div className="ui-message-grid">
        <div><StateLabel>Loading</StateLabel><CritBoundaryMessage style={{ height: "auto", minHeight: 140 }}>Opening canvas…</CritBoundaryMessage></div>
        <div><StateLabel>Error</StateLabel><CritBoundaryMessage error style={{ height: "auto", minHeight: 140 }}>Canvas could not be opened: the local document is unavailable.</CritBoundaryMessage></div>
      </div>
    </SpecimenSection>
  )
}

export default function UiLab() {
  const recipes = useDialKit("Crit UI color assignments", RECIPE_CONFIG, {
    id: "crit-ui-color-assignments"
  })
  const assignments = useMemo(() => assignmentsFor(recipes), [recipes])
  const tokenValues = useMemo(() => new Map<TokenName, string>(
    BASE_TOKENS.map((token): readonly [TokenName, string] => {
      const column = recipes.baseScale[token.shortName]
      const chroma = recipes.baseScale.greyscale || token.palette === "neutral"
        ? 0
        : column.chroma
      const hue = token.palette === "neutral" || chroma === 0
        ? "none"
        : recipes.baseScale.hues[token.palette]
      return [
        token.name,
        `oklch(${column.lightness}% ${chroma} ${hue})`
      ]
    })
  ), [recipes.baseScale])
  const recipeStyle = useMemo(() => cssVariableStyle(Object.fromEntries(
    [
      ...assignments.map(({ token, variable }) => [variable, `var(${token})`]),
      ...tokenValues
    ]
  )), [assignments, tokenValues])
  return (
    <CanvasActionRunnerProvider>
      <style data-crit-ui-styles="">{critStyles}</style>
      <div
        className="ui-lab-shell"
        data-greyscale={recipes.baseScale.greyscale || undefined}
        style={recipeStyle}
      >
        <CritOverlayProvider className="ui-lab-overlays">
          <main className="ui-lab">
            <ColorScale values={tokenValues} />
            <ToolbarSpecimens />
            <FramesSpecimens />
            <NotesSpecimens />
            <FeedbackSpecimens />
            <MenuSpecimens />
            <DialogSpecimens />
            <CommentSpecimens />
            <MessageSpecimens />
          </main>

          <aside aria-label="DialKit color controls" className="ui-lab-dials">
            <DialRoot
              mode="inline"
              productionEnabled
              theme="light"
            />
          </aside>
        </CritOverlayProvider>
      </div>
    </CanvasActionRunnerProvider>
  )
}
