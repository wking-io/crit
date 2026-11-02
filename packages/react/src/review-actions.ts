import {
  AuthoredText,
  Id,
  WebUrlRepresentation,
  type CanvasCommand,
  type CanvasCommandBatch,
  type CanvasProjection,
  type Frame,
  type FrameId,
  type LiveRepresentation,
  type ReviewStatus,
  proposeAddFrame,
  proposeBringToFront,
  proposeRemoveFrame,
  proposeRenameCanvas,
  proposeSendToBack,
  proposeSetFrameGeometry,
  proposeSetFrameStatus,
  proposeSetFrameTitle
} from "@crit/domain"
import { Data, Effect, Match, Option, Predicate, Schema } from "effect"

import {
  Align,
  ArrangeGrid,
  CanvasArrangement,
  Distribute,
  type CanvasAlignment,
  type CanvasArrangementOperation
} from "./canvas-arrangement.js"
import type { CanvasSelection } from "./canvas-selection.js"
import {
  DEFAULT_NEW_FRAME_SIZE,
  DUPLICATE_FRAME_GAP,
  FRAME_SIZE_PRESETS
} from "./frame-breakpoints.js"

export type ReviewAction = Data.TaggedEnum<{
  readonly batch: { readonly commands: CanvasCommandBatch }
  readonly effect: { readonly effect: ReviewClientEffect }
  readonly snapshot: { readonly request: SnapshotRequest }
}>
export const ReviewAction = Data.taggedEnum<ReviewAction>()

export interface SnapshotSource {
  readonly title: Frame["title"]
  readonly status: Frame["status"]
  readonly geometry: Frame["geometry"]
  readonly representation: LiveRepresentation
}

export type SnapshotRequest = readonly [
  SnapshotSource,
  ...SnapshotSource[]
]

export type ReviewClientEffect = Data.TaggedEnum<{
  readonly openUrl: { readonly url: string }
  readonly openFrame: {}
  readonly fullscreen: { readonly target: "frame" | "exit" }
  readonly copy: { readonly text: string }
  readonly zoomToFit: {}
  readonly reloadFrame: {}
}>
export const ReviewClientEffect = Data.taggedEnum<ReviewClientEffect>()

export type ReviewSelection = Data.TaggedEnum<{
  readonly items: { readonly items: CanvasSelection }
}>
export const ReviewSelection = Data.taggedEnum<ReviewSelection>()

export type ReviewActionInput = Data.TaggedEnum<{
  readonly none: {}
  readonly text: { readonly text: string }
  readonly addFrame: {
    readonly url: string
    readonly title: string
    readonly x: number
    readonly y: number
  }
  readonly height: { readonly height: number }
}>
export const ReviewActionInput = Data.taggedEnum<ReviewActionInput>()

export interface ReviewActionContext {
  readonly projection: CanvasProjection
  readonly selection: ReviewSelection
  readonly input: ReviewActionInput
  readonly fullscreen: boolean
}

export type ReviewShortcut =
  | "Delete"
  | "Backspace"
  | "Enter"
  | "Escape"
  | "F"
  | "O"
  | "R"
  | "S"
  | "1"
  | "2"
  | "3"
  | "4"
  | "Shift+1"
  | "Shift+2"
  | "Shift+3"
  | "Shift+4"
  | "Shift+5"
  | "Alt+W"
  | "Alt+S"
  | "Alt+A"
  | "Alt+D"
  | "Alt+V"
  | "Alt+H"
  | "Alt+G"
  | "Control+Alt+H"
  | "Control+Alt+V"
  | "Mod+]"
  | "Mod+["
  | "Mod+Shift+C"

export type ReviewActionScope =
  | "canvas"
  | "fullscreen"
  | "new-frame-form"
  | "canvas-title-edit"

export type ReviewActionAvailability = Data.TaggedEnum<{
  readonly enabled: {}
  readonly disabled: {
    readonly reason: string
    readonly message: string
  }
  readonly hidden: {
    readonly reason: string
    readonly message: string
  }
}>
export const ReviewActionAvailability = Data.taggedEnum<ReviewActionAvailability>()

export type ReviewControlPlatform = "macos" | "windows" | "linux" | "unknown"

export interface ResolvedReviewAction<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly description: string
  readonly shortcuts: readonly ReviewShortcut[]
  readonly shortcut: string | null
  readonly ariaKeyShortcuts: string | null
  readonly availability: ReviewActionAvailability
}

export interface ReviewShortcutPolicy<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly description: string
  readonly shortcuts: readonly ReviewShortcut[]
  readonly scopes: readonly ReviewActionScope[]
}

export type ReviewActionControl<Id extends string = string> =
  | ReviewActionPolicy<Id>
  | ResolvedReviewAction<Id>

export interface ReviewActionPolicy<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly description: string
  readonly shortcuts: readonly ReviewShortcut[]
  readonly scopes: readonly ReviewActionScope[]
  readonly unavailableReason: string
  readonly unavailableMessage: string
  readonly unavailableState: "disabled" | "hidden"
  readonly available: (
    selection: ReviewSelection,
    projection: CanvasProjection
  ) => boolean
  readonly run: (context: ReviewActionContext) => ReviewAction | null
}

type ReviewActionDeclaration<Id extends string> = Omit<
  ReviewActionPolicy<Id>,
  "scopes" | "unavailableReason" | "unavailableMessage" | "unavailableState"
> & {
  readonly scopes?: readonly ReviewActionScope[]
  readonly unavailableReason?: string
  readonly unavailableMessage?: string
  readonly unavailableState?: "disabled" | "hidden"
}

const policy = <const Id extends string>(
  value: ReviewActionDeclaration<Id>
): ReviewActionPolicy<Id> => ({
  ...value,
  scopes: value.scopes ?? ["canvas"],
  unavailableReason: value.unavailableReason ?? "action-unavailable",
  unavailableMessage: value.unavailableMessage ??
    "This action is not available for the current selection.",
  unavailableState: value.unavailableState ?? "disabled"
})

const selectedFrames = (
  selection: ReviewSelection,
  projection: CanvasProjection
): readonly Frame[] =>
  selection.items.flatMap((item) =>
    Match.value(item).pipe(
      Match.tag("frame", (item) => {
        const frame = projection.frames.find((entry) => entry.frameId === item.frameId)
        return frame === undefined ? [] : [frame]
      }),
      Match.orElse(() => [])
    )
  )

const selectedFrame = (
  selection: ReviewSelection,
  projection: CanvasProjection
): Frame | undefined => {
  const frames = selectedFrames(selection, projection)
  return frames.length === 1 ? frames[0] : undefined
}

const isLiveFrame = (frame: Frame): boolean =>
  !Predicate.isTagged(frame.representation, "artifact")

const snapshotSources = (
  selection: ReviewSelection,
  projection: CanvasProjection
): readonly SnapshotSource[] =>
  selectedFrames(selection, projection).flatMap((frame) => {
    if (Predicate.isTagged(frame.representation, "artifact")) return []
    return [{
      title: frame.title,
      status: frame.status,
      geometry: frame.geometry,
      representation: frame.representation
    }]
  })

const reviewBatch = (
  commands: readonly CanvasCommand[]
): ReviewAction | null => {
  const [first, ...rest] = commands
  return first === undefined
    ? null
    : ReviewAction.batch({ commands: [first, ...rest] })
}

const mintFrameId = (): FrameId =>
  Id.frame(`frame_${crypto.randomUUID().replaceAll("-", "")}`)

const textInput = (input: ReviewActionInput) => {
  if (!ReviewActionInput.$is("text")(input)) return undefined
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(AuthoredText)(input.text.trim())
  )
}

const addFrameInput = (input: ReviewActionInput) => {
  if (!ReviewActionInput.$is("addFrame")(input)) return undefined
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return undefined
  const title = Option.getOrUndefined(
    Schema.decodeUnknownOption(AuthoredText)(input.title.trim())
  )
  const representation = Option.getOrUndefined(
    Schema.decodeUnknownOption(WebUrlRepresentation)({
      _tag: "webUrl",
      url: input.url
    })
  )
  if (title === undefined || representation === undefined) return undefined
  return { representation, title, x: input.x, y: input.y }
}

const heightInput = (input: ReviewActionInput) => {
  if (!ReviewActionInput.$is("height")(input)) return undefined
  if (!Number.isFinite(input.height) || input.height < 120) return undefined
  return input.height
}

const alignmentDescription = {
  left: "Align the selected Frames to the left of their shared bounds.",
  "horizontal-center":
    "Align the selected Frames to the horizontal center of their shared bounds.",
  right: "Align the selected Frames to the right of their shared bounds.",
  top: "Align the selected Frames to the top of their shared bounds.",
  "vertical-center":
    "Align the selected Frames to the vertical center of their shared bounds.",
  bottom: "Align the selected Frames to the bottom of their shared bounds."
} as const satisfies Record<CanvasAlignment, string>

const alignmentShortcuts = {
  top: ["Alt+W"],
  bottom: ["Alt+S"],
  left: ["Alt+A"],
  right: ["Alt+D"],
  "vertical-center": ["Alt+V"],
  "horizontal-center": ["Alt+H"]
} as const satisfies Record<CanvasAlignment, readonly ReviewShortcut[]>

const statusShortcuts = {
  "in-progress": ["1"],
  "ready-for-review": ["2"],
  "changes-requested": ["3"],
  approved: ["4"]
} as const satisfies Record<
  Exclude<ReviewStatus, "archived">,
  readonly ReviewShortcut[]
>

const renameCanvasPolicy = policy({
  id: "rename-canvas",
  label: "Rename canvas",
  description: "Rename this canvas.",
  shortcuts: [],
  available: () => true,
  run: ({ input, projection }) => {
    const title = textInput(input)
    return title === undefined
      ? null
      : reviewBatch([proposeRenameCanvas(projection, title)])
  }
})

const removePolicy = policy({
  id: "remove",
  label: "Remove",
  description: "Remove the selected Frames from the canvas.",
  shortcuts: ["Backspace", "Delete"],
  unavailableReason: "selection-required",
  unavailableMessage: "Select at least one Frame to remove it.",
  available: (selection, projection) =>
    selectedFrames(selection, projection).length > 0,
  run: ({ projection, selection }) =>
    reviewBatch(selectedFrames(selection, projection).map(proposeRemoveFrame))
})

const snapshotPolicy = policy({
  id: "snapshot",
  label: "Snapshot",
  description: "Capture the selected live Frames into new artifact Frames.",
  shortcuts: ["S"],
  unavailableReason: "live-frame-selection-required",
  unavailableMessage: "Select at least one live Frame to take a snapshot.",
  available: (selection, projection) =>
    snapshotSources(selection, projection).length > 0,
  run: ({ projection, selection }) => {
    const [first, ...rest] = snapshotSources(selection, projection)
    return first === undefined
      ? null
      : ReviewAction.snapshot({ request: [first, ...rest] })
  }
})

const bringToFrontPolicy = policy({
  id: "bring-to-front",
  label: "Bring to front",
  description: "Place this Frame above every other canvas item.",
  shortcuts: ["Mod+]"],
  unavailableReason: "single-frame-required",
  unavailableMessage: "Select one Frame to bring it to front.",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined
      ? null
      : reviewBatch([proposeBringToFront(projection, frame)])
  }
})

const sendToBackPolicy = policy({
  id: "send-to-back",
  label: "Send to back",
  description: "Place this Frame behind every other canvas item.",
  shortcuts: ["Mod+["],
  unavailableReason: "single-frame-required",
  unavailableMessage: "Select one Frame to send it to back.",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined
      ? null
      : reviewBatch([proposeSendToBack(projection, frame)])
  }
})

const setFrameTitlePolicy = policy({
  id: "set-frame-title",
  label: "Set frame title",
  description: "Rename this Frame.",
  shortcuts: [],
  unavailableReason: "single-frame-required",
  unavailableMessage: "Select one Frame to rename it.",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ input, projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    const title = textInput(input)
    return frame === undefined || title === undefined
      ? null
      : reviewBatch([proposeSetFrameTitle(frame, title)])
  }
})

const frameStatusPolicies = ([
  "in-progress",
  "ready-for-review",
  "changes-requested",
  "approved"
] as const satisfies readonly Exclude<ReviewStatus, "archived">[]).map((status) => policy({
  id: `set-frame-status-${status}` as const,
  label: `Set status to ${status}`,
  description: `Set this Frame's review status to ${status}.`,
  shortcuts: statusShortcuts[status],
  unavailableReason: "status-already-set-or-selection-required",
  unavailableMessage: `Select a Frame whose status is not ${status}.`,
  available: (selection, projection) =>
    selectedFrames(selection, projection).some((frame) => frame.status !== status),
  run: ({ projection, selection }) =>
    reviewBatch(
      selectedFrames(selection, projection).flatMap((frame) =>
        frame.status === status
          ? []
          : [proposeSetFrameStatus(frame, status)]
      )
    )
}))

const arrangementAction = (
  context: ReviewActionContext,
  operation: CanvasArrangementOperation
): ReviewAction | null => {
  const selected = selectedFrames(context.selection, context.projection)
  const plan = Option.getOrUndefined(Effect.runSync(Effect.option(
    CanvasArrangement.plan({
      operation,
      items: selected.map((frame) => ({
        id: frame.frameId,
        ...frame.geometry
      }))
    })
  )))
  if (plan === undefined) return null
  const byId = new Map<string, Frame>(selected.map((frame) => [frame.frameId, frame]))
  return reviewBatch(plan.moves.flatMap((move) => {
    const frame = byId.get(move.id)
    if (frame === undefined) return []
    return [proposeSetFrameGeometry(frame, {
      ...frame.geometry,
      x: move.x,
      y: move.y
    })]
  }))
}

const alignmentPolicy = (alignment: CanvasAlignment) => policy({
  id: `align-${alignment}` as const,
  label: `Align ${alignment}`,
  description: alignmentDescription[alignment],
  shortcuts: alignmentShortcuts[alignment],
  unavailableReason: "multiple-frame-selection-required",
  unavailableMessage: "Select at least two Frames to align them.",
  available: (selection, projection) =>
    selectedFrames(selection, projection).length >= 2,
  run: (context) => arrangementAction(context, Align.make({ alignment }))
})

const distributionPolicy = (axis: "horizontal" | "vertical") => policy({
  id: `distribute-${axis}` as const,
  label: `Distribute ${axis}`,
  description: `Equalize the ${axis} gaps between the selected Frames.`,
  shortcuts: axis === "horizontal" ? ["Control+Alt+H"] : ["Control+Alt+V"],
  unavailableReason: "three-frame-selection-required",
  unavailableMessage: "Select at least three Frames to distribute them.",
  available: (selection, projection) =>
    selectedFrames(selection, projection).length >= 3,
  run: (context) => arrangementAction(context, Distribute.make({ axis }))
})

const arrangeGridPolicy = policy({
  id: "arrange-grid",
  label: "Arrange grid",
  description: "Arrange the selected Frames into a grid.",
  shortcuts: ["Alt+G"],
  unavailableReason: "multiple-frame-selection-required",
  unavailableMessage: "Select at least two Frames to arrange them.",
  available: (selection, projection) =>
    selectedFrames(selection, projection).length >= 2,
  run: (context) => arrangementAction(context, ArrangeGrid.make({}))
})

const presetShortcuts = {
  mobile: ["Shift+1"],
  tablet: ["Shift+2"],
  laptop: ["Shift+3"],
  desktop: ["Shift+4"],
  widescreen: ["Shift+5"]
} as const satisfies Record<
  (typeof FRAME_SIZE_PRESETS)[number]["id"],
  readonly ReviewShortcut[]
>

const framePresetPolicies = FRAME_SIZE_PRESETS.map((preset) => policy({
  id: `resize-frame-${preset.id}` as const,
  label: `Resize to ${preset.label}`,
  description: `Resize this Frame to the ${preset.label.toLowerCase()} preset.`,
  shortcuts: presetShortcuts[preset.id],
  unavailableReason: "single-resizable-frame-required",
  unavailableMessage: "Select one Frame at a different size to resize it.",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined &&
      (frame.geometry.width !== preset.width ||
        frame.geometry.height !== preset.height)
  },
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined
      ? null
      : reviewBatch([proposeSetFrameGeometry(frame, {
        ...frame.geometry,
        width: preset.width,
        height: preset.height
      })])
  }
}))

const reloadFramePolicy = policy({
  id: "reload-frame",
  label: "Reload frame",
  description: "Reload the selected Frame's page.",
  shortcuts: ["R"],
  unavailableReason: "single-live-frame-required",
  unavailableMessage: "Select one live Frame to reload it.",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && isLiveFrame(frame)
  },
  run: ({ selection, projection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined || !isLiveFrame(frame)
      ? null
      : ReviewAction.effect({ effect: ReviewClientEffect.reloadFrame() })
  }
})

const openUrlPolicy = policy({
  id: "open-url",
  label: "Open in new tab",
  description: "Open this Frame's page in a new browser tab.",
  shortcuts: ["O"],
  unavailableReason: "web-frame-required",
  unavailableMessage: "Select one live web Frame to open it.",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && isLiveFrame(frame)
  },
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    if (frame === undefined) return null
    return Match.value(frame.representation).pipe(
      Match.tag("webUrl", ({ url }) => ReviewAction.effect({
        effect: ReviewClientEffect.openUrl({ url })
      })),
      Match.tag("applicationRoute", () => ReviewAction.effect({
        effect: ReviewClientEffect.openFrame()
      })),
      Match.orElse(() => null)
    )
  }
})

const enterFullscreenPolicy = policy({
  id: "enter-fullscreen",
  label: "Enter fullscreen",
  description: "Expand this Frame to fill the screen.",
  shortcuts: ["F"],
  unavailableReason: "single-frame-required",
  unavailableMessage: "Select one Frame to enter fullscreen.",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ fullscreen }) => fullscreen
    ? null
    : ReviewAction.effect({
      effect: ReviewClientEffect.fullscreen({ target: "frame" })
    })
})

const exitFullscreenPolicy = policy({
  id: "exit-fullscreen",
  label: "Exit fullscreen",
  description: "Return this Frame to the canvas.",
  shortcuts: ["Escape"],
  scopes: ["fullscreen"],
  unavailableReason: "fullscreen-required",
  unavailableMessage: "Enter fullscreen before using this action.",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ fullscreen }) => fullscreen
    ? ReviewAction.effect({
      effect: ReviewClientEffect.fullscreen({ target: "exit" })
    })
    : null
})

const copyNodeIdPolicy = policy({
  id: "copy-node-id",
  label: "Copy node ID",
  description: "Copy this Frame's stable ID.",
  shortcuts: ["Mod+Shift+C"],
  unavailableReason: "single-frame-required",
  unavailableMessage: "Select one Frame to copy its ID.",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    if (frame === undefined) return null
    return ReviewAction.effect({
      effect: ReviewClientEffect.copy({ text: frame.frameId })
    })
  }
})

const addFramePolicy = policy({
  id: "add-frame",
  label: "Add frame",
  description: "Add a live web page to the current canvas.",
  shortcuts: [],
  available: () => true,
  run: ({ input }) => {
    const frame = addFrameInput(input)
    return frame === undefined
      ? null
      : reviewBatch([proposeAddFrame({
        frameId: mintFrameId(),
        title: frame.title,
        representation: frame.representation,
        status: "in-progress",
        geometry: {
          x: frame.x,
          y: frame.y,
          width: DEFAULT_NEW_FRAME_SIZE.width,
          height: DEFAULT_NEW_FRAME_SIZE.height
        }
      })])
  }
})

const zoomToFitPolicy = policy({
  id: "zoom-to-fit",
  label: "Zoom to fit",
  description: "Adjust the view so every Frame is visible.",
  shortcuts: [],
  unavailableReason: "canvas-empty",
  unavailableMessage: "Add a Frame before zooming to fit.",
  available: (_selection, projection) => projection.frames.length > 0,
  run: () => ReviewAction.effect({
    effect: ReviewClientEffect.zoomToFit()
  })
})

const fitFrameContentPolicy = policy({
  id: "fit-frame-content",
  label: "Fit frame content",
  description: "Resize the Frame height to fit its same-origin page content.",
  shortcuts: [],
  unavailableReason: "live-frame-required",
  unavailableMessage: "Select one live Frame to fit its content.",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && isLiveFrame(frame)
  },
  run: ({ input, projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    const height = heightInput(input)
    if (frame === undefined || height === undefined) return null
    if (frame.geometry.height === height) return null
    return reviewBatch([proposeSetFrameGeometry(frame, {
      ...frame.geometry,
      height
    })])
  }
})

const duplicateFrame = (
  frame: Frame,
  size: { readonly width: number; readonly height: number }
): ReviewAction | null => reviewBatch([proposeAddFrame({
  frameId: mintFrameId(),
  title: frame.title,
  representation: frame.representation,
  status: frame.status,
  geometry: {
    x: frame.geometry.x - size.width - DUPLICATE_FRAME_GAP,
    y: frame.geometry.y,
    width: size.width,
    height: size.height
  }
})])

const duplicateFrameCurrentPolicy = policy({
  id: "duplicate-frame-current",
  label: "Duplicate at current size",
  description: "Duplicate this live Frame at its current viewport size.",
  shortcuts: [],
  unavailableReason: "live-frame-required",
  unavailableMessage: "Select one live Frame to duplicate it.",
  unavailableState: "hidden",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && isLiveFrame(frame)
  },
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined || !isLiveFrame(frame)
      ? null
      : duplicateFrame(frame, frame.geometry)
  }
})

const duplicateFrameAllBreakpointsPolicy = policy({
  id: "duplicate-frame-all-breakpoints",
  label: "Duplicate at all breakpoints",
  description: "Duplicate this live Frame at every standard viewport size.",
  shortcuts: [],
  unavailableReason: "live-frame-required",
  unavailableMessage: "Select one live Frame to duplicate it.",
  unavailableState: "hidden",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && isLiveFrame(frame)
  },
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    if (frame === undefined || !isLiveFrame(frame)) return null
    let right = frame.geometry.x - DUPLICATE_FRAME_GAP
    return reviewBatch(FRAME_SIZE_PRESETS.map((preset) => {
      const x = right - preset.width
      right = x - DUPLICATE_FRAME_GAP
      return proposeAddFrame({
        frameId: mintFrameId(),
        title: frame.title,
        representation: frame.representation,
        status: frame.status,
        geometry: {
          x,
          y: frame.geometry.y,
          width: preset.width,
          height: preset.height
        }
      })
    }))
  }
})

const frameDuplicatePolicies = FRAME_SIZE_PRESETS.map((preset) => policy({
  id: `duplicate-frame-${preset.id}` as const,
  label: `Duplicate at ${preset.label}`,
  description:
    `Duplicate this live Frame at the ${preset.label.toLowerCase()} preset.`,
  shortcuts: [],
  unavailableReason: "live-frame-required",
  unavailableMessage: "Select one live Frame to duplicate it.",
  unavailableState: "hidden",
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && isLiveFrame(frame)
  },
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined || !isLiveFrame(frame)
      ? null
      : duplicateFrame(frame, preset)
  }
}))

export const reviewActionPolicies = [
  renameCanvasPolicy,
  addFramePolicy,
  zoomToFitPolicy,
  removePolicy,
  snapshotPolicy,
  bringToFrontPolicy,
  sendToBackPolicy,
  setFrameTitlePolicy,
  ...frameStatusPolicies,
  alignmentPolicy("left"),
  alignmentPolicy("horizontal-center"),
  alignmentPolicy("right"),
  alignmentPolicy("top"),
  alignmentPolicy("vertical-center"),
  alignmentPolicy("bottom"),
  distributionPolicy("horizontal"),
  distributionPolicy("vertical"),
  arrangeGridPolicy,
  ...framePresetPolicies,
  duplicateFrameCurrentPolicy,
  duplicateFrameAllBreakpointsPolicy,
  ...frameDuplicatePolicies,
  fitFrameContentPolicy,
  openUrlPolicy,
  reloadFramePolicy,
  enterFullscreenPolicy,
  exitFullscreenPolicy,
  copyNodeIdPolicy
] as const satisfies readonly ReviewActionPolicy[]

const activeReviewScopeSets: readonly (readonly ReviewActionScope[])[] = [
  ["canvas"],
  ["fullscreen"],
  ["canvas", "new-frame-form"],
  ["canvas", "canvas-title-edit"]
]

const shortcutKey = (shortcut: ReviewShortcut): string => shortcut.toLowerCase()

export const validateReviewActionPolicies = (
  policies: readonly ReviewShortcutPolicy[]
): void => {
  const ids = new Set<string>()
  for (const declaration of policies) {
    if (ids.has(declaration.id)) {
      throw new TypeError(`Review action ${declaration.id} has multiple policy declarations`)
    }
    ids.add(declaration.id)
  }
  for (const activeScopes of activeReviewScopeSets) {
    const shortcuts = new Map<string, string>()
    for (const declaration of policies) {
      if (!declaration.scopes.some((scope) => activeScopes.includes(scope))) continue
      for (const shortcut of declaration.shortcuts) {
        const key = shortcutKey(shortcut)
        const previous = shortcuts.get(key)
        if (previous !== undefined && previous !== declaration.id) {
          throw new TypeError(
            `Review shortcut conflict in ${activeScopes.join("+")}: ` +
            `${previous} and ${declaration.id} use ${shortcut}`
          )
        }
        shortcuts.set(key, declaration.id)
      }
    }
  }
}

export const reviewNativeActionPolicies = [
  {
    id: "create-frame",
    label: "Add frame",
    description: "Create a live Frame using the entered URL and title.",
    shortcuts: ["Enter"],
    scopes: ["new-frame-form"]
  },
  {
    id: "cancel-new-frame",
    label: "Cancel adding frame",
    description: "Close the dialog without adding a Frame.",
    shortcuts: ["Escape"],
    scopes: ["new-frame-form"]
  },
  {
    id: "save-canvas-title",
    label: "Save title",
    description: "Save the edited canvas title.",
    shortcuts: ["Enter"],
    scopes: ["canvas-title-edit"]
  },
  {
    id: "cancel-canvas-title",
    label: "Cancel",
    description: "Discard the edited canvas title.",
    shortcuts: ["Escape"],
    scopes: ["canvas-title-edit"]
  }
] as const satisfies readonly ReviewShortcutPolicy[]

export type ReviewNativeActionId = (typeof reviewNativeActionPolicies)[number]["id"]

export const reviewNativeActionPolicy = (
  id: ReviewNativeActionId
): ReviewShortcutPolicy<ReviewNativeActionId> => {
  const declaration = reviewNativeActionPolicies.find((entry) => entry.id === id)
  if (declaration === undefined) throw new Error(`Missing native review policy: ${id}`)
  return declaration
}

validateReviewActionPolicies([
  ...reviewActionPolicies,
  ...reviewNativeActionPolicies
])

export const reviewControlPlatform = (
  raw: string | undefined = globalThis.navigator?.platform
): ReviewControlPlatform => {
  if (raw === undefined) return "unknown"
  if (/Mac/i.test(raw)) return "macos"
  if (/Win/i.test(raw)) return "windows"
  if (/Linux/i.test(raw)) return "linux"
  return "unknown"
}

const actualPlatform = (platform: ReviewControlPlatform) =>
  platform === "unknown" ? "macos" : platform

export const displayReviewShortcut = (
  shortcut: ReviewShortcut,
  platform: ReviewControlPlatform
): string => {
  const resolved = actualPlatform(platform)
  const parts = shortcut.split("+")
  const key = parts.pop() ?? shortcut
  const modifiers = parts.map((part) => {
    if (part === "Mod") return resolved === "macos" ? "⌘" : "Ctrl"
    if (part === "Control") return resolved === "macos" ? "⌃" : "Ctrl"
    if (part === "Alt") return resolved === "macos" ? "⌥" : "Alt"
    if (part === "Shift") return resolved === "macos" ? "⇧" : "Shift"
    return part
  })
  const displayKey = key === "Backspace"
    ? resolved === "macos" ? "⌫" : "Backspace"
    : key === "Escape" ? "Esc" : key
  return resolved === "macos"
    ? `${modifiers.join("")}${displayKey}`
    : [...modifiers, displayKey].join("+")
}

export const displayReviewShortcuts = (
  shortcuts: readonly ReviewShortcut[],
  platform: ReviewControlPlatform = reviewControlPlatform()
): readonly string[] =>
  shortcuts.includes("Delete") && shortcuts.includes("Backspace")
    ? ["⌫"]
    : shortcuts.map((shortcut) => displayReviewShortcut(shortcut, platform))

const ariaReviewShortcut = (
  shortcut: ReviewShortcut,
  platform: ReviewControlPlatform
): string => {
  const resolved = actualPlatform(platform)
  return shortcut.split("+").map((part) =>
    part === "Mod" ? resolved === "macos" ? "Meta" : "Control" : part
  ).join("+")
}

export const reviewActionAriaKeyShortcuts = (
  action: ReviewShortcutPolicy | ResolvedReviewAction,
  platform: ReviewControlPlatform = reviewControlPlatform()
): string | undefined => {
  if ("ariaKeyShortcuts" in action) return action.ariaKeyShortcuts ?? undefined
  return action.shortcuts.length === 0
    ? undefined
    : action.shortcuts.map((shortcut) =>
        ariaReviewShortcut(shortcut, platform)
      ).join(" ")
}

export const resolveReviewActionPolicy = <Id extends string>(
  declaration: ReviewActionPolicy<Id>,
  input: {
    readonly selection: ReviewSelection
    readonly projection: CanvasProjection
    readonly platform?: ReviewControlPlatform
    readonly available?: boolean
    readonly unavailableReason?: string
    readonly unavailableMessage?: string
    readonly unavailableState?: "disabled" | "hidden"
  }
): ResolvedReviewAction<Id> => {
  const platform = input.platform ?? reviewControlPlatform()
  const available = input.available ??
    declaration.available(input.selection, input.projection)
  return {
    id: declaration.id,
    label: declaration.label,
    description: declaration.description,
    shortcuts: declaration.shortcuts,
    shortcut: declaration.shortcuts[0] === undefined
      ? null
      : displayReviewShortcut(declaration.shortcuts[0], platform),
    ariaKeyShortcuts: declaration.shortcuts.length === 0
      ? null
      : declaration.shortcuts.map((shortcut) =>
          ariaReviewShortcut(shortcut, platform)
        ).join(" "),
    availability: available
      ? ReviewActionAvailability.enabled()
      : ReviewActionAvailability[input.unavailableState ?? declaration.unavailableState]({
          reason: input.unavailableReason ?? declaration.unavailableReason,
          message: input.unavailableMessage ?? declaration.unavailableMessage
        })
  }
}

export type ReviewActionId = (typeof reviewActionPolicies)[number]["id"]

export const reviewActionPolicy = (
  id: ReviewActionId
): ReviewActionPolicy<ReviewActionId> => {
  const policy = reviewActionPolicies.find((entry) => entry.id === id)
  if (policy === undefined) throw new Error(`Missing review policy: ${id}`)
  return policy
}

export const availableReviewActions = (
  context: Pick<ReviewActionContext, "projection" | "selection">
): readonly ReviewActionPolicy<ReviewActionId>[] =>
  reviewActionPolicies.filter((candidate) =>
    candidate.available(context.selection, context.projection)
  )

export const resolveReviewAction = (
  id: ReviewActionId,
  context: ReviewActionContext
): ReviewAction | null => {
  const candidate = reviewActionPolicies.find((entry) => entry.id === id)
  return candidate === undefined ||
      !candidate.available(context.selection, context.projection)
    ? null
    : candidate.run(context)
}
