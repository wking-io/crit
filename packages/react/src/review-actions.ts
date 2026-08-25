import {
  AuthoredText,
  type CanvasCommand,
  type CanvasCommandBatch,
  type CanvasProjection,
  type Frame,
  type LiveRepresentation,
  type ReviewStatus,
  proposeBringToFront,
  proposeRemoveFrame,
  proposeRenameCanvas,
  proposeSendToBack,
  proposeSetFrameGeometry,
  proposeSetFrameStatus,
  proposeSetFrameTitle
} from "@crit/domain"
import { Data, Effect, Option, Schema } from "effect"

import {
  CanvasArrangement,
  type CanvasAlignment,
  type CanvasArrangementOperation
} from "./canvas-arrangement.js"
import type { CanvasSelection } from "./canvas-selection.js"
import { FRAME_SIZE_PRESETS } from "./frame-breakpoints.js"

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
  readonly "open-url": { readonly url: string }
  readonly fullscreen: { readonly target: "frame" | "exit" }
  readonly copy: { readonly text: string }
}>
export const ReviewClientEffect = Data.taggedEnum<ReviewClientEffect>()

export type ReviewSelection = {
  readonly _tag: "items"
  readonly items: CanvasSelection
}

export type ReviewActionInput = Data.TaggedEnum<{
  readonly none: {}
  readonly text: { readonly text: string }
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
  | "Escape"
  | "F"
  | "O"
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

export interface ReviewActionPolicy<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly description: string
  readonly shortcuts: readonly ReviewShortcut[]
  readonly available: (
    selection: ReviewSelection,
    projection: CanvasProjection
  ) => boolean
  readonly run: (context: ReviewActionContext) => ReviewAction | null
}

const policy = <const Id extends string>(
  value: ReviewActionPolicy<Id>
): ReviewActionPolicy<Id> => value

const selectedFrames = (
  selection: ReviewSelection,
  projection: CanvasProjection
): readonly Frame[] =>
  selection.items.flatMap((item) => {
    if (item._tag !== "frame") return []
    const frame = projection.frames.find((entry) => entry.frameId === item.frameId)
    return frame === undefined ? [] : [frame]
  })

const selectedFrame = (
  selection: ReviewSelection,
  projection: CanvasProjection
): Frame | undefined => {
  const frames = selectedFrames(selection, projection)
  return frames.length === 1 ? frames[0] : undefined
}

const snapshotSources = (
  selection: ReviewSelection,
  projection: CanvasProjection
): readonly SnapshotSource[] =>
  selectedFrames(selection, projection).flatMap((frame) => {
    if (frame.representation._tag === "artifact") return []
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

const textInput = (input: ReviewActionInput) => {
  if (input._tag !== "text") return undefined
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(AuthoredText)(input.text.trim())
  )
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
  shortcuts: ["Delete", "Backspace"],
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
  available: (selection, projection) =>
    selectedFrames(selection, projection).length >= 2,
  run: (context) => arrangementAction(context, { _tag: "Align", alignment })
})

const distributionPolicy = (axis: "horizontal" | "vertical") => policy({
  id: `distribute-${axis}` as const,
  label: `Distribute ${axis}`,
  description: `Equalize the ${axis} gaps between the selected Frames.`,
  shortcuts: axis === "horizontal" ? ["Control+Alt+H"] : ["Control+Alt+V"],
  available: (selection, projection) =>
    selectedFrames(selection, projection).length >= 3,
  run: (context) => arrangementAction(context, { _tag: "Distribute", axis })
})

const arrangeGridPolicy = policy({
  id: "arrange-grid",
  label: "Arrange grid",
  description: "Arrange the selected Frames into a grid.",
  shortcuts: ["Alt+G"],
  available: (selection, projection) =>
    selectedFrames(selection, projection).length >= 2,
  run: (context) => arrangementAction(context, { _tag: "ArrangeGrid" })
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

const openUrlPolicy = policy({
  id: "open-url",
  label: "Open in new tab",
  description: "Open this Frame's page in a new browser tab.",
  shortcuts: ["O"],
  available: (selection, projection) =>
    selectedFrame(selection, projection)?.representation._tag === "web-url",
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame?.representation._tag === "web-url"
      ? ReviewAction.effect({
        effect: ReviewClientEffect["open-url"]({ url: frame.representation.url })
      })
      : null
  }
})

const enterFullscreenPolicy = policy({
  id: "enter-fullscreen",
  label: "Enter fullscreen",
  description: "Expand this Frame to fill the screen.",
  shortcuts: ["F"],
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

export const reviewActionPolicies = [
  renameCanvasPolicy,
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
  openUrlPolicy,
  enterFullscreenPolicy,
  exitFullscreenPolicy,
  copyNodeIdPolicy
] as const satisfies readonly ReviewActionPolicy[]

export type ReviewActionId = (typeof reviewActionPolicies)[number]["id"]

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

