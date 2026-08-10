import {
  DialRoot,
  useDialKit,
  type DialConfig,
  type SelectConfig
} from "dialkit"
import { Effect } from "effect"
import {
  useMemo,
  type CSSProperties,
  type ReactNode
} from "react"

import type {
  CanvasCommentThread,
  CanvasFrame,
  CanvasNote,
  CommentAuthor,
  FrameReviewStatus
} from "../../src/core/index.js"
import { CritContextMenu, type ContextMenuItem } from "../../src/react/canvas-context-menu.js"
import { AgentActivityIndicator, CanvasSaveIndicator, CritBoundaryMessage } from "../../src/react/canvas-feedback.js"
import { CanvasHelpPanel } from "../../src/react/canvas-help.js"
import { CanvasCommentPin } from "../../src/react/canvas-comment-pin.js"
import { CanvasSelection } from "../../src/react/canvas-selection.js"
import { CanvasToolbar } from "../../src/react/canvas-toolbar.js"
import { CommentPopover } from "../../src/react/comment-popover.js"
import { critStyles } from "../../src/react/crit-styles.js"
import { FRAME_STATUSES, frameStatus } from "../../src/react/frame-chrome.js"
import { FrameCard } from "../../src/react/frame-card.js"
import { Glyph } from "../../src/react/glyph.js"
import { NewFrameForm } from "../../src/react/new-frame-dialog.js"
import { NoteCard } from "../../src/react/note-card.js"

import "dialkit/styles.css"
import "./base-tokens.css"
import "./ui-lab.css"

type TokenStep = "s1" | "s2" | "c1" | "c2" | "c3" | "p1" | "p2" | "t1" | "t2"
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

type LabStyle = CSSProperties & Record<`--${string}`, string | number>
type TokenValues = Readonly<Record<TokenName, string>>

const TOKEN_STEPS: ReadonlyArray<TokenStep> = [
  "s1", "s2", "c1", "c2", "c3", "p1", "p2", "t1", "t2"
]

const COLUMN_DEFAULTS: Record<TokenStep, {
  readonly lightness: number
  readonly chroma: number
}> = {
  s1: { lightness: 99, chroma: 0.003 },
  s2: { lightness: 97.5, chroma: 0.009 },
  c1: { lightness: 95.25, chroma: 0.024 },
  c2: { lightness: 94, chroma: 0.028 },
  c3: { lightness: 92.75, chroma: 0.036 },
  p1: { lightness: 67, chroma: 0.18 },
  p2: { lightness: 65, chroma: 0.2 },
  t1: { lightness: 52, chroma: 0.2 },
  t2: { lightness: 28, chroma: 0.1 }
}

const HUE_DEFAULTS: Record<ChromaticPalette, number> = {
  orange: 41.1,
  blue: 245.3,
  green: 156.3,
  purple: 302,
  red: 27.3
}

const slider = (
  value: number,
  min: number,
  max: number,
  step: number
): [number, number, number, number] => [value, min, max, step]

const tokenName = (palette: PaletteName, step: TokenStep): TokenName =>
  (palette === "neutral"
    ? `--crit-color-${step}`
    : `--crit-color-${palette}-${step}`) as TokenName

const BASE_PALETTES: ReadonlyArray<{
  readonly id: PaletteName
  readonly label: string
}> = [
  { id: "neutral", label: "Neutral · Archived" },
  { id: "orange", label: "Orange · Changes" },
  { id: "blue", label: "Blue · Progress" },
  { id: "green", label: "Green · Approved" },
  { id: "purple", label: "Purple · Review" },
  { id: "red", label: "Red · Destructive" }
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

const tokenSelect = (defaultValue: TokenName): SelectConfig => ({
  type: "select",
  options: TOKEN_OPTIONS,
  default: defaultValue
})

const BASE_SCALE_CONFIG = {
  greyscale: false,
  hues: {
    _collapsed: true,
    orange: slider(HUE_DEFAULTS.orange, 0, 360, 0.1),
    blue: slider(HUE_DEFAULTS.blue, 0, 360, 0.1),
    green: slider(HUE_DEFAULTS.green, 0, 360, 0.1),
    purple: slider(HUE_DEFAULTS.purple, 0, 360, 0.1),
    red: slider(HUE_DEFAULTS.red, 0, 360, 0.1)
  },
  ...Object.fromEntries(TOKEN_STEPS.map((step) => [step, {
    _collapsed: true,
    lightness: slider(COLUMN_DEFAULTS[step].lightness, 0, 100, 0.25),
    chroma: slider(COLUMN_DEFAULTS[step].chroma, 0, 0.3, 0.001)
  }])) as Record<TokenStep, {
    readonly _collapsed: boolean
    readonly lightness: [number, number, number, number]
    readonly chroma: [number, number, number, number]
  }>
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
  frame: {
    _collapsed: true,
    viewportSurface: tokenSelect("--crit-color-s1"),
    selectedOutline: tokenSelect("--crit-color-t1"),
    handleSurface: tokenSelect("--crit-color-s1")
  },
  frameStatus: {
    _collapsed: true,
    changesRequested: {
      shell: tokenSelect("--crit-color-orange-c1"),
      stroke: tokenSelect("--crit-color-orange-p1"),
      ink: tokenSelect("--crit-color-orange-t1")
    },
    inProgress: {
      shell: tokenSelect("--crit-color-blue-c1"),
      stroke: tokenSelect("--crit-color-blue-p1"),
      ink: tokenSelect("--crit-color-blue-t1")
    },
    archived: {
      shell: tokenSelect("--crit-color-c1"),
      stroke: tokenSelect("--crit-color-p1"),
      ink: tokenSelect("--crit-color-t2")
    },
    approved: {
      shell: tokenSelect("--crit-color-green-c1"),
      stroke: tokenSelect("--crit-color-green-p1"),
      ink: tokenSelect("--crit-color-green-t1")
    },
    readyForReview: {
      shell: tokenSelect("--crit-color-purple-c1"),
      stroke: tokenSelect("--crit-color-purple-p1"),
      ink: tokenSelect("--crit-color-purple-t1")
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
  note: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-c1"),
    editingSurface: tokenSelect("--crit-color-s1"),
    chromeSurface: tokenSelect("--crit-color-t2"),
    chromeText: tokenSelect("--crit-color-s1"),
    text: tokenSelect("--crit-color-t2"),
    border: tokenSelect("--crit-color-t2"),
    selectedOutline: tokenSelect("--crit-color-t1"),
    handleSurface: tokenSelect("--crit-color-s1")
  },
  help: {
    _collapsed: true,
    surface: tokenSelect("--crit-color-s2"),
    border: tokenSelect("--crit-color-c3"),
    label: tokenSelect("--crit-color-t1"),
    text: tokenSelect("--crit-color-t2")
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

const kebabCase = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()

const assignmentVariable = (path: ReadonlyArray<string>): `--ui-${string}` =>
  `--ui-${path.map(kebabCase).join("-")}`

const flattenAssignments = (
  value: unknown,
  path: ReadonlyArray<string> = []
): ReadonlyArray<Assignment> => {
  if (typeof value === "string" && value.startsWith("--crit-color-")) {
    return [{
      token: value as TokenName,
      variable: assignmentVariable(path)
    }]
  }
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === "_collapsed" ? [] : flattenAssignments(child, [...path, key])
  )
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

function ColorScale({ values }: { readonly values: TokenValues }) {
  return (
    <SpecimenSection id="01" title="Base color scale">
      <div className="ui-palette-table">
        {BASE_PALETTES.map((palette) => (
          <div className="ui-palette-row" key={palette.id}>
            <span className="ui-palette-row__label">{palette.label}</span>
            <ol aria-label={`${palette.label} base color tokens`} className="ui-scale">
              {BASE_TOKENS.filter((token) => token.palette === palette.id).map((token, index) => (
                <li
                  className="ui-scale__token"
                  key={token.name}
                  style={{
                    "--ui-scale-color": `var(${token.name})`,
                    "--ui-scale-ink": index < 5
                      ? "var(--crit-color-t2)"
                      : "var(--crit-color-s1)"
                  } as LabStyle}
                  title={`${token.name}: ${values[token.name]}`}
                >
                  <strong>{token.shortName}</strong>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}

const TOOLBAR_BUTTON_STATES: ReadonlyArray<{
  readonly icon: "pointer" | "pan" | "addFrame" | "comment" | "undo"
  readonly label: string
  readonly state: "default" | "hover" | "focus" | "pressed" | "disabled"
}> = [
  { icon: "pointer", label: "Default", state: "default" },
  { icon: "pan", label: "Hover", state: "hover" },
  { icon: "addFrame", label: "Focus", state: "focus" },
  { icon: "comment", label: "Pressed", state: "pressed" },
  { icon: "undo", label: "Unavailable", state: "disabled" }
]

function ToolbarSpecimens() {
  return (
    <SpecimenSection id="02" title="Canvas toolbar">
      <div className="ui-toolbar-stage">
        <CanvasToolbar
          commentAvailable
          onAction={() => {}}
          title="Feature lab"
          tool="select"
        />
      </div>
      <div className="ui-state-grid ui-state-grid--buttons">
        {TOOLBAR_BUTTON_STATES.map(({ icon, label, state }) => (
          <div className="ui-state-cell" key={state}>
            <StateLabel>{label}</StateLabel>
            <button
              aria-disabled={state === "disabled" || undefined}
              aria-pressed={state === "pressed" || undefined}
              className="crit-icon-button ui-toolbar-button--large"
              data-state={state}
              type="button"
            ><Glyph name={icon} /></button>
          </div>
        ))}
      </div>
    </SpecimenSection>
  )
}

function FrameSpecimen({
  mode = "full",
  selected = false,
  state = "loaded",
  status
}: {
  readonly mode?: "full" | "compact" | "minimal"
  readonly selected?: boolean
  readonly state?: "loaded" | "editing" | "snapshotting" | "paused" | "fullscreen"
  readonly status: (typeof FRAME_STATUSES)[number]
}) {
  const width = mode === "full" ? 330 : mode === "compact" ? 170 : 90
  const geometry = { x: 12, y: 42, width, height: 176 }
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
      style={{ width: width + 24 }}
    >
      <FrameCard
        commentMode={false}
        commentThreads={[]}
        frame={frame}
        geometry={geometry}
        iframeAllow=""
        iframeVisible={state !== "paused"}
        onBringToFront={() => {}}
        onCommentAnchor={() => {}}
        onFitContent={() => {}}
        onInputIntent={() => {}}
        onMove={() => {}}
        onOpenComment={() => {}}
        onRemove={() => {}}
        onResize={() => {}}
        onSelect={() => {}}
        onSendToBack={() => {}}
        onSetSize={() => {}}
        onSnapshot={() => Effect.succeed(undefined)}
        onSnapshotError={() => {}}
        onStatus={() => {}}
        onTitle={() => {}}
        selected={selected}
        shortId="A"
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
      <div className="ui-status-menu-grid">
        {FRAME_STATUSES.map((status, index) => {
          const state = (["default", "hover", "selected", "disabled", "default"] as const)[index]!
          return (
            <div className="ui-state-cell" key={status.id}>
              <StateLabel>{state}</StateLabel>
              <button
                aria-checked={state === "selected"}
                className="crit-status-option"
                data-state={state}
                disabled={state === "disabled"}
                style={{ "--status-ink": status.ink, "--status-shell": status.shell } as LabStyle}
                type="button"
              ><Glyph name={status.glyph} />{status.label}</button>
            </div>
          )
        })}
      </div>
    </SpecimenSection>
  )
}

function SelectionSpecimen() {
  return (
    <div className="crit-canvas ui-selection-demo">
      <span>Eight resize hit areas</span>
      <CanvasSelection
        ink={frameStatus("in-progress").ink}
        label="frame"
        onResize={() => {}}
        zoom={1}
      />
    </div>
  )
}

function NoteSpecimen({
  attached = false,
  editing = false,
  empty = false,
  selected = false
}: {
  readonly attached?: boolean
  readonly editing?: boolean
  readonly empty?: boolean
  readonly selected?: boolean
}) {
  const geometry = { x: 10, y: 34, width: 240, height: 150 }
  const note: CanvasNote = {
    id: `lab-note-${attached}-${empty}`,
    text: empty ? "" : "Tighten the hierarchy around the primary action before review.",
    geometry,
    attachedTo: attached ? "Checkout candidate" : null,
    zIndex: 1
  }
  return (
    <div className="crit-canvas ui-production-canvas ui-note-stage" data-editing={editing || undefined}>
      <NoteCard
        geometry={geometry}
        note={note}
        onBringToFront={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onResize={() => {}}
        onSelect={() => {}}
        onSendToBack={() => {}}
        onText={() => {}}
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
        <div><StateLabel>Focused editing</StateLabel><NoteSpecimen editing /></div>
        <div><StateLabel>Empty</StateLabel><NoteSpecimen empty /></div>
        <div><StateLabel>Selection handles</StateLabel><SelectionSpecimen /></div>
      </div>
    </SpecimenSection>
  )
}

function FeedbackSpecimens() {
  return (
    <SpecimenSection id="05" title="Help, presence, and save state">
      <div className="ui-feedback-grid">
        <div><StateLabel>Help · hotkey</StateLabel><CanvasHelpPanel details={{ name: "Add frame", hotkey: "F", description: "Create a live frame at the center of the visible canvas." }} /></div>
        <div><StateLabel>Help · no hotkey / long copy</StateLabel><CanvasHelpPanel details={{ name: "Resize Checkout candidate", hotkey: "—", description: "Drag this handle to resize the frame while preserving its opposite edge and minimum dimensions." }} /></div>
        <div className="ui-feedback-badges">
          <StateLabel>Agent presence</StateLabel>
          <AgentActivityIndicator detail="arranging frames" />
          <AgentActivityIndicator detail={null} />
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

const FRAME_MENU_ITEMS: ReadonlyArray<ContextMenuItem> = [
  { label: "Open frame", help: "Open the frame source.", href: "about:blank", detail: <Glyph name="externalArrow" /> },
  { label: "Fit content", help: "Fit the frame height to its content.", onSelect: () => {}, detail: "F" },
  {
    label: "Set size",
    help: "Apply a standard viewport size.",
    items: [
      { label: "Mobile", help: "Use a mobile viewport.", onSelect: () => {}, detail: "402 × 874" },
      { label: "Tablet", help: "Use a tablet viewport.", onSelect: () => {}, detail: "832 × 1194" },
      { label: "Laptop", help: "Use a laptop viewport.", onSelect: () => {}, detail: "1280 × 832" },
      { label: "Desktop", help: "Use a desktop viewport.", onSelect: () => {}, detail: "1512 × 982" },
      { label: "Widescreen", help: "Use a widescreen viewport.", onSelect: () => {}, detail: "2560 × 1440" }
    ]
  },
  { label: "Bring to front", help: "Move this frame above other items.", onSelect: () => {} },
  { label: "Delete", help: "Remove this frame.", onSelect: () => {}, tone: "danger" }
]

const EMPTY_MENU_ITEMS: ReadonlyArray<ContextMenuItem> = [
  { label: "New frame", help: "Add a frame here.", onSelect: () => {} },
  { label: "New note", help: "Add a note here.", onSelect: () => {} },
  { label: "Zoom to fit", help: "Fit all canvas items in view.", onSelect: () => {} }
]

function ContextMenuSpecimen({ ariaLabel, items }: {
  readonly ariaLabel: string
  readonly items: ReadonlyArray<ContextMenuItem>
}) {
  return (
    <CritContextMenu
      ariaLabel={ariaLabel}
      inline
      items={items}
      onClose={() => {}}
      position={{ x: 0, y: 0 }}
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
  return <span className="crit-new-frame-dialog__actions"><button data-primary={primary ? "" : undefined} data-state={state} disabled={state === "disabled"} type="button">{children}</button></span>
}

function DialogSpecimens() {
  return (
    <SpecimenSection id="07" title="Dialog and form controls">
      <div className="ui-dialog-stage">
        <NewFrameForm onCancel={() => {}} onCreate={() => {}} onError={() => {}} />
      </div>
      <div className="crit-new-frame-dialog ui-form-state-grid">
        <label><StateLabel>Empty</StateLabel><input placeholder="https://example.com/iteration" /></label>
        <label><StateLabel>Populated</StateLabel><input defaultValue="Checkout candidate" /></label>
        <label><StateLabel>Focused</StateLabel><input className="is-focus" defaultValue="Checkout candidate" /></label>
        <label><StateLabel>Disabled</StateLabel><input defaultValue="Unavailable" disabled /></label>
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
    <CanvasCommentPin active={active} authorName={label} color={color} onOpen={() => {}} xRatio={0.5} yRatio={0.8} />
  </span>
}

function CommentSpecimens() {
  const owner: CommentAuthor = { id: "wes", name: "Wes King" }
  const collaborator: CommentAuthor = { id: "alex", name: "Alex Morgan" }
  const viewer: CommentAuthor = { id: "sam", name: "Sam Lee" }
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
        <div><StateLabel>New · empty submit disabled</StateLabel><CommentPopover author={owner} inline owner={owner} statusColor={color} onClose={() => {}} onCreate={() => {}} onEdit={() => {}} onReply={() => {}} onResolve={() => {}} /></div>
        <div><StateLabel>Thread · owner can resolve</StateLabel><CommentPopover author={owner} inline owner={owner} statusColor={color} thread={thread} onClose={() => {}} onCreate={() => {}} onEdit={() => {}} onReply={() => {}} onResolve={() => {}} /></div>
        <div><StateLabel>Thread · no resolve permission</StateLabel><CommentPopover author={viewer} inline owner={owner} statusColor={color} thread={thread} onClose={() => {}} onCreate={() => {}} onEdit={() => {}} onReply={() => {}} onResolve={() => {}} /></div>
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
  const assignments = useMemo(() => flattenAssignments(recipes), [recipes])
  const tokenValues = useMemo(() => Object.fromEntries(
    BASE_TOKENS.map((token) => {
      const column = recipes.baseScale[token.shortName]
      const chroma = recipes.baseScale.greyscale || token.palette === "neutral"
        ? 0
        : column.chroma
      const hue = chroma === 0
        ? "none"
        : recipes.baseScale.hues[token.palette as ChromaticPalette]
      return [
        token.name,
        `oklch(${column.lightness}% ${chroma} ${hue})`
      ]
    })
  ) as Record<TokenName, string>, [recipes.baseScale])
  const recipeStyle = useMemo(() => Object.fromEntries(
    [
      ...assignments.map(({ token, variable }) => [variable, `var(${token})`]),
      ...Object.entries(tokenValues)
    ]
  ) as LabStyle, [assignments, tokenValues])
  return (
    <>
      <style data-crit-ui-styles="">{critStyles}</style>
      <div
        className="ui-lab-shell"
        data-greyscale={recipes.baseScale.greyscale || undefined}
        style={recipeStyle}
      >
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
      </div>
    </>
  )
}
