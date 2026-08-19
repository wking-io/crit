import { Effect, Match, Predicate, Schema } from "effect"

import { defaultRuntimeCapabilities } from "../runtime/runtime-capabilities.js"

const actionIds = [
  "select-tool",
  "hand-tool",
  "open-new-frame",
  "create-frame",
  "cancel-new-frame",
  "create-note",
  "activate-comment-tool",
  "place-comment",
  "zoom-in",
  "zoom-out",
  "zoom-to-fit",
  "open-arrangement-menu",
  "align-selection",
  "distribute-selection",
  "arrange-selection-grid",
  "close-arrangement-menu",
  "begin-canvas-title-edit",
  "save-canvas-title-edit",
  "cancel-canvas-title-edit",
  "remove-item",
  "bring-item-to-front",
  "send-item-to-back",
  "set-note-color",
  "copy-node-id",
  "open-frame-status",
  "set-frame-status",
  "begin-frame-title-edit",
  "save-frame-title-edit",
  "cancel-frame-title-edit",
  "show-frame-breakpoints",
  "take-frame-snapshot",
  "open-frame-new-tab",
  "enter-frame-fullscreen",
  "exit-frame-fullscreen",
  "open-frame-size-menu",
  "resize-frame-to-preset",
  "open-frame-duplicate-menu",
  "duplicate-frame-at-preset",
  "fit-frame-content",
  "open-comment",
  "close-comment",
  "begin-comment-edit",
  "cancel-comment-edit",
  "save-comment-edit",
  "submit-comment",
  "submit-reply",
  "resolve-comment-thread",
  "reopen-comment-thread",
  "close-context-menu"
] as const

export const CanvasActionId = Schema.Literals(actionIds)
export type CanvasActionId = typeof CanvasActionId.Type

export const CanvasControlPlatform = Schema.Literals([
  "macos",
  "windows",
  "linux",
  "unknown"
])
export type CanvasControlPlatform = typeof CanvasControlPlatform.Type

export const CanvasControlScope = Schema.Literals([
  "canvas",
  "canvas-title-edit",
  "new-frame-form",
  "frame-title-edit",
  "comment-compose",
  "comment-edit",
  "menu",
  "arrangement-menu",
  "fullscreen"
])
export type CanvasControlScope = typeof CanvasControlScope.Type

export const CanvasActionAvailability = Schema.Literals([
  "enabled",
  "disabled",
  "hidden"
])
export type CanvasActionAvailability = typeof CanvasActionAvailability.Type

export const CanvasActionConsequence = Schema.Literals([
  "standard",
  "destructive"
])
export type CanvasActionConsequence = typeof CanvasActionConsequence.Type

export const CanvasActionUnavailableReason = Schema.Literals([
  "missing-comment-author",
  "item-removal-forbidden",
  "note-edit-forbidden",
  "frame-not-live",
  "frame-not-editable",
  "snapshot-unavailable",
  "empty-comment",
  "comment-not-editable",
  "comment-thread-not-manageable",
  "multiple-selection-required",
  "three-item-selection-required",
  "action-pending"
])
export type CanvasActionUnavailableReason =
  typeof CanvasActionUnavailableReason.Type

export const CanvasActionTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("frame"),
    id: Schema.String,
    label: Schema.String
  }),
  Schema.Struct({
    kind: Schema.Literal("note"),
    id: Schema.String,
    label: Schema.String
  }),
  Schema.Struct({
    kind: Schema.Literal("comment-thread"),
    id: Schema.String,
    label: Schema.String
  }),
  Schema.Struct({
    kind: Schema.Literal("comment"),
    id: Schema.String,
    label: Schema.String
  })
])
export type CanvasActionTarget = typeof CanvasActionTarget.Type

const FrameTarget = Schema.Struct({
  kind: Schema.Literal("frame"),
  id: Schema.String,
  label: Schema.String
})
const NoteTarget = Schema.Struct({
  kind: Schema.Literal("note"),
  id: Schema.String,
  label: Schema.String
})
const CommentThreadTarget = Schema.Struct({
  kind: Schema.Literal("comment-thread"),
  id: Schema.String,
  label: Schema.String
})
const CommentTarget = Schema.Struct({
  kind: Schema.Literal("comment"),
  id: Schema.String,
  label: Schema.String
})

const FrameReviewStatus = Schema.Literals([
  "in-progress",
  "ready-for-review",
  "approved",
  "changes-requested"
])
const FrameSizePresetId = Schema.Literals([
  "mobile",
  "tablet",
  "laptop",
  "desktop",
  "widescreen"
])
const AlignmentId = Schema.Literals([
  "left",
  "horizontal-center",
  "right",
  "top",
  "vertical-center",
  "bottom"
])
const DistributionAxis = Schema.Literals(["horizontal", "vertical"])

const noTargetRequest = <Id extends CanvasActionId>(id: Id) =>
  Schema.Struct({ id: Schema.Literal(id) })
const targetedRequest = <Id extends CanvasActionId>(id: Id) =>
  Schema.Struct({ id: Schema.Literal(id), target: CanvasActionTarget })
const frameRequest = <Id extends CanvasActionId>(id: Id) =>
  Schema.Struct({ id: Schema.Literal(id), target: FrameTarget })
const threadRequest = <Id extends CanvasActionId>(id: Id) =>
  Schema.Struct({ id: Schema.Literal(id), target: CommentThreadTarget })

export const CanvasActionRequest = Schema.Union([
  noTargetRequest("select-tool"),
  noTargetRequest("hand-tool"),
  noTargetRequest("open-new-frame"),
  noTargetRequest("create-frame"),
  noTargetRequest("cancel-new-frame"),
  noTargetRequest("zoom-in"),
  noTargetRequest("zoom-out"),
  noTargetRequest("zoom-to-fit"),
  Schema.Struct({
    id: Schema.Literal("open-arrangement-menu"),
    selectionHasMultipleItems: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("align-selection"),
    alignment: AlignmentId,
    selectionHasMultipleItems: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("distribute-selection"),
    axis: DistributionAxis,
    selectionHasThreeItems: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("arrange-selection-grid"),
    selectionHasMultipleItems: Schema.Boolean
  }),
  noTargetRequest("close-arrangement-menu"),
  noTargetRequest("begin-canvas-title-edit"),
  noTargetRequest("save-canvas-title-edit"),
  noTargetRequest("cancel-canvas-title-edit"),
  noTargetRequest("close-context-menu"),
  noTargetRequest("create-note"),
  noTargetRequest("activate-comment-tool"),
  Schema.Struct({
    id: Schema.Literal("remove-item"),
    target: FrameTarget
  }),
  Schema.Struct({
    id: Schema.Literal("remove-item"),
    target: NoteTarget,
    currentAuthorIsTargetAuthor: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("set-note-color"),
    target: NoteTarget,
    currentAuthorIsTargetAuthor: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("copy-node-id"),
    target: NoteTarget
  }),
  targetedRequest("bring-item-to-front"),
  targetedRequest("send-item-to-back"),
  Schema.Struct({
    id: Schema.Literal("open-frame-status"),
    target: FrameTarget,
    frameIsLive: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("set-frame-status"),
    target: FrameTarget,
    status: FrameReviewStatus,
    frameIsLive: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("begin-frame-title-edit"),
    target: FrameTarget,
    editable: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("save-frame-title-edit"),
    target: FrameTarget,
    editable: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("cancel-frame-title-edit"),
    target: FrameTarget,
    editable: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("show-frame-breakpoints"),
    target: FrameTarget,
    frameIsLive: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("place-comment"),
    target: FrameTarget,
    frameIsLive: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("take-frame-snapshot"),
    target: FrameTarget,
    snapshotAvailable: Schema.Boolean
  }),
  frameRequest("open-frame-new-tab"),
  frameRequest("enter-frame-fullscreen"),
  frameRequest("exit-frame-fullscreen"),
  frameRequest("open-frame-size-menu"),
  Schema.Struct({
    id: Schema.Literal("resize-frame-to-preset"),
    target: FrameTarget,
    preset: FrameSizePresetId
  }),
  Schema.Struct({
    id: Schema.Literal("open-frame-duplicate-menu"),
    target: FrameTarget,
    frameIsLive: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("duplicate-frame-at-preset"),
    target: FrameTarget,
    preset: FrameSizePresetId,
    frameIsLive: Schema.Boolean
  }),
  frameRequest("fit-frame-content"),
  threadRequest("open-comment"),
  targetedRequest("close-comment"),
  Schema.Struct({
    id: Schema.Literal("begin-comment-edit"),
    target: CommentTarget,
    editable: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("cancel-comment-edit"),
    target: CommentTarget,
    editable: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("save-comment-edit"),
    target: CommentTarget,
    editable: Schema.Boolean,
    bodyPresent: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("submit-comment"),
    target: FrameTarget,
    bodyPresent: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("submit-reply"),
    target: CommentThreadTarget,
    bodyPresent: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("resolve-comment-thread"),
    target: CommentThreadTarget,
    manageable: Schema.Boolean
  }),
  Schema.Struct({
    id: Schema.Literal("reopen-comment-thread"),
    target: CommentThreadTarget,
    manageable: Schema.Boolean
  })
])
export type CanvasActionRequest = typeof CanvasActionRequest.Type

const SemanticModifier = Schema.Literals(["mod", "shift", "alt"])
export const CanvasActionBinding = Schema.Struct({
  key: Schema.String,
  modifiers: Schema.Array(SemanticModifier),
  delivery: Schema.Literals(["registered", "native"]),
  role: Schema.Literals(["primary", "alias"])
})
export type CanvasActionBinding = typeof CanvasActionBinding.Type

const FactRequirement = Schema.Union([
  Schema.Struct({
    source: Schema.Literal("global"),
    fact: Schema.Literal("commentAuthorPresent"),
    equals: Schema.Boolean
  }),
  Schema.Struct({
    source: Schema.Literal("target"),
    fact: Schema.Literals([
      "currentAuthorIsTargetAuthor",
      "frameIsLive",
      "editable",
      "snapshotAvailable",
      "bodyPresent",
      "manageable"
    ]),
    equals: Schema.Boolean
  }),
  Schema.Struct({
    source: Schema.Literal("request"),
    fact: Schema.Literals([
      "selectionHasMultipleItems",
      "selectionHasThreeItems"
    ]),
    equals: Schema.Boolean
  }),
  Schema.Struct({
    source: Schema.Literal("execution"),
    fact: Schema.Literal("actionPending"),
    equals: Schema.Boolean
  })
])

const AvailabilityGuard = Schema.Struct({
  requirement: FactRequirement,
  targetKinds: Schema.optionalKey(Schema.Array(Schema.Literals([
    "frame",
    "note",
    "comment-thread",
    "comment"
  ]))),
  onFailure: Schema.Struct({
    state: Schema.Literals(["disabled", "hidden"]),
    reason: CanvasActionUnavailableReason,
    message: Schema.String
  })
})

export const CanvasActionPolicy = Schema.Struct({
  id: CanvasActionId,
  scopes: Schema.Array(CanvasControlScope),
  bindings: Schema.Array(CanvasActionBinding),
  guards: Schema.Array(AvailabilityGuard),
  consequence: CanvasActionConsequence,
  label: Schema.String,
  description: Schema.String
})
export type CanvasActionPolicy = typeof CanvasActionPolicy.Type

export const CanvasControlState = Schema.Struct({
  platform: CanvasControlPlatform,
  activeScopes: Schema.Array(CanvasControlScope),
  globalFacts: Schema.Struct({
    commentAuthorPresent: Schema.Boolean
  }),
  pendingActions: Schema.Array(Schema.String)
})
export type CanvasControlState = typeof CanvasControlState.Type

const resolvedCanvasActionFields = {
  key: Schema.String,
  id: CanvasActionId,
  target: Schema.NullOr(CanvasActionTarget),
  label: Schema.String,
  description: Schema.String,
  consequence: CanvasActionConsequence,
  shortcut: Schema.NullOr(Schema.String),
  ariaKeyShortcuts: Schema.NullOr(Schema.String),
  bindings: Schema.Array(CanvasActionBinding)
}

export const ResolvedCanvasAction = Schema.Union([
  Schema.Struct({
    ...resolvedCanvasActionFields,
    availability: Schema.Literal("enabled")
  }),
  Schema.Struct({
    ...resolvedCanvasActionFields,
    availability: Schema.Literals(["disabled", "hidden"]),
    reason: CanvasActionUnavailableReason,
    availabilityMessage: Schema.String
  })
])
export type ResolvedCanvasAction = typeof ResolvedCanvasAction.Type

export class CanvasActionUnavailable extends Schema.TaggedError<CanvasActionUnavailable>()(
  "CanvasActionUnavailable",
  {
    actionKey: Schema.String,
    actionId: CanvasActionId,
    availability: Schema.Literals(["disabled", "hidden"]),
    reason: CanvasActionUnavailableReason
  }
) {}

type Guard = typeof AvailabilityGuard.Type
type Binding = typeof CanvasActionBinding.Type

const primary = (
  key: string,
  modifiers: ReadonlyArray<typeof SemanticModifier.Type> = [],
  delivery: Binding["delivery"] = "registered"
): Binding => ({ key, modifiers, delivery, role: "primary" })

const alias = (
  key: string,
  modifiers: ReadonlyArray<typeof SemanticModifier.Type> = [],
  delivery: Binding["delivery"] = "registered"
): Binding => ({ key, modifiers, delivery, role: "alias" })

const failedGuard = (
  source: "global" | "target",
    fact: "commentAuthorPresent" | "currentAuthorIsTargetAuthor" | "frameIsLive" | "editable" |
    "snapshotAvailable" | "bodyPresent" | "manageable",
  reason: CanvasActionUnavailableReason,
  message: string,
  state: "disabled" | "hidden" = "disabled"
): Guard => {
  if (source === "global") {
    if (fact !== "commentAuthorPresent") {
      throw new TypeError(`Global guard cannot use target fact ${fact}`)
    }
    return {
      requirement: { source, fact, equals: true },
      onFailure: { state, reason, message }
    }
  }
  if (fact === "commentAuthorPresent") {
    throw new TypeError("Target guard cannot use global fact commentAuthorPresent")
  }
  return {
    requirement: { source, fact, equals: true },
    onFailure: { state, reason, message }
  }
}

const notPending: Guard = {
  requirement: { source: "execution", fact: "actionPending", equals: false },
  onFailure: {
    state: "disabled",
    reason: "action-pending",
    message: "Wait for this action to finish."
  }
}

const noteAuthorRequired: Guard = {
  requirement: {
    source: "target",
    fact: "currentAuthorIsTargetAuthor",
    equals: true
  },
  targetKinds: ["note"],
  onFailure: {
    state: "hidden",
    reason: "item-removal-forbidden",
    message: "Only the Note Author may remove it."
  }
}

const noteColorAuthorRequired: Guard = {
  requirement: {
    source: "target",
    fact: "currentAuthorIsTargetAuthor",
    equals: true
  },
  targetKinds: ["note"],
  onFailure: {
    state: "hidden",
    reason: "note-edit-forbidden",
    message: "Only the Note Author may change its color."
  }
}

const selectionRequired = (
  fact: "selectionHasMultipleItems" | "selectionHasThreeItems",
  reason: "multiple-selection-required" | "three-item-selection-required",
  message: string
): Guard => ({
  requirement: { source: "request", fact, equals: true },
  onFailure: { state: "disabled", reason, message }
})

const policy = (
  declaration: Omit<CanvasActionPolicy, "guards"> & {
    readonly guards?: ReadonlyArray<Guard>
  }
): CanvasActionPolicy => ({
  ...declaration,
  guards: [...(declaration.guards ?? []), notPending]
})

const canvasPolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "select-tool", scopes: ["canvas"], bindings: [primary("V")], consequence: "standard", label: "Select", description: "Drag empty canvas to select multiple Frames and Notes; hold Shift or Cmd/Ctrl to add to the selection." }),
  policy({ id: "hand-tool", scopes: ["canvas"], bindings: [primary("H")], consequence: "standard", label: "Hand", description: "Drag the canvas to pan without selecting an item." }),
  policy({ id: "open-new-frame", scopes: ["canvas", "menu"], bindings: [primary("F")], guards: [failedGuard("global", "commentAuthorPresent", "missing-comment-author", "Sign in to add a frame.")], consequence: "standard", label: "Add frame", description: "Add a live web page to the current canvas." }),
  policy({ id: "create-note", scopes: ["canvas", "menu"], bindings: [primary("N")], guards: [failedGuard("global", "commentAuthorPresent", "missing-comment-author", "Sign in to add a note.")], consequence: "standard", label: "Add note", description: "Click the canvas to place a note." }),
  policy({ id: "activate-comment-tool", scopes: ["canvas"], bindings: [], guards: [failedGuard("global", "commentAuthorPresent", "missing-comment-author", "Sign in to leave comments.")], consequence: "standard", label: "Add comment", description: "Pin feedback to an element or location inside a live frame." }),
  policy({ id: "zoom-in", scopes: ["canvas"], bindings: [primary("=", ["mod"]), alias("=", ["mod", "shift"])], consequence: "standard", label: "Zoom in", description: "Increase the canvas zoom level." }),
  policy({ id: "zoom-out", scopes: ["canvas"], bindings: [primary("-", ["mod"]), alias("-", ["mod", "shift"])], consequence: "standard", label: "Zoom out", description: "Decrease the canvas zoom level." }),
  policy({ id: "zoom-to-fit", scopes: ["canvas", "menu"], bindings: [], consequence: "standard", label: "Zoom to fit", description: "Adjust the view so every frame and note is visible." }),
  policy({ id: "open-arrangement-menu", scopes: ["canvas"], bindings: [], guards: [selectionRequired("selectionHasMultipleItems", "multiple-selection-required", "Select at least two Frames or Notes to align and distribute them.")], consequence: "standard", label: "Align and distribute", description: "Align, distribute, or arrange the selected canvas items." })
]

const arrangementPolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "align-selection", scopes: ["arrangement-menu"], bindings: [], guards: [selectionRequired("selectionHasMultipleItems", "multiple-selection-required", "Select at least two Frames or Notes to align them.")], consequence: "standard", label: "Align {alignmentLabel}", description: "Align the selected items to the {alignmentDescription} of their collective bounds." }),
  policy({ id: "distribute-selection", scopes: ["arrangement-menu"], bindings: [], guards: [selectionRequired("selectionHasThreeItems", "three-item-selection-required", "Select at least three Frames or Notes to distribute them.")], consequence: "standard", label: "Distribute {distributionAxisLabel}", description: "Preserve the outer selected items and equalize the {distributionGapLabel} gaps between them." }),
  policy({ id: "arrange-selection-grid", scopes: ["arrangement-menu"], bindings: [], guards: [selectionRequired("selectionHasMultipleItems", "multiple-selection-required", "Select at least two Frames or Notes to arrange them.")], consequence: "standard", label: "Arrange in grid", description: "Organize the selected items into a balanced, non-overlapping grid." }),
  policy({ id: "close-arrangement-menu", scopes: ["arrangement-menu"], bindings: [primary("Escape", [], "native")], consequence: "standard", label: "Close align and distribute", description: "Close the alignment and distribution menu." })
]

const newFrameFormPolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "create-frame", scopes: ["new-frame-form"], bindings: [primary("Enter", [], "native")], consequence: "standard", label: "Add frame", description: "Create a live frame using the entered URL and title." }),
  policy({ id: "cancel-new-frame", scopes: ["new-frame-form"], bindings: [primary("Escape", [], "native")], consequence: "standard", label: "Cancel adding frame", description: "Close the dialog without adding a frame." })
]

const canvasTitlePolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "begin-canvas-title-edit", scopes: ["canvas"], bindings: [], consequence: "standard", label: "Rename canvas", description: "Change the current canvas title while preserving its stable canvas ID." }),
  policy({ id: "save-canvas-title-edit", scopes: ["canvas-title-edit"], bindings: [primary("Enter", [], "native")], consequence: "standard", label: "Save title", description: "Save the edited canvas title." }),
  policy({ id: "cancel-canvas-title-edit", scopes: ["canvas-title-edit"], bindings: [primary("Escape", [], "native")], consequence: "standard", label: "Cancel", description: "Discard the edited canvas title." })
]

const itemPolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "remove-item", scopes: ["canvas", "menu"], bindings: [primary("Backspace"), alias("Delete")], guards: [noteAuthorRequired], consequence: "destructive", label: "Delete", description: "Remove this {targetKind} from the canvas." }),
  policy({ id: "bring-item-to-front", scopes: ["menu"], bindings: [], consequence: "standard", label: "Bring to front", description: "Place this {targetKind} above every other canvas item." }),
  policy({ id: "send-item-to-back", scopes: ["menu"], bindings: [], consequence: "standard", label: "Send to back", description: "Place this {targetKind} behind every other canvas item." }),
  policy({ id: "set-note-color", scopes: ["menu"], bindings: [], guards: [noteColorAuthorRequired], consequence: "standard", label: "Note color", description: "Change this Note's color family." }),
  policy({ id: "copy-node-id", scopes: ["menu"], bindings: [], consequence: "standard", label: "Copy node ID", description: "Copy this Note's stable node ID for sharing with development agents." })
]

const framePolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "open-frame-status", scopes: ["canvas"], bindings: [], guards: [failedGuard("target", "frameIsLive", "frame-not-live", "Snapshot frames remain archived and cannot change status.")], consequence: "standard", label: "Change frame status", description: "Review or change this frame's current workflow status." }),
  policy({ id: "set-frame-status", scopes: ["canvas"], bindings: [], guards: [failedGuard("target", "frameIsLive", "frame-not-live", "Snapshot frames remain archived and cannot change status.")], consequence: "standard", label: "{statusLabel}", description: "Set this frame's workflow status to {statusLabel}." }),
  policy({ id: "begin-frame-title-edit", scopes: ["canvas"], bindings: [], guards: [failedGuard("target", "editable", "frame-not-editable", "Snapshot frame titles cannot be changed.")], consequence: "standard", label: "Edit title", description: "Rename this frame while preserving its stable frame ID." }),
  policy({ id: "save-frame-title-edit", scopes: ["frame-title-edit"], bindings: [primary("Enter", [], "native")], guards: [failedGuard("target", "editable", "frame-not-editable", "Snapshot frame titles cannot be changed.")], consequence: "standard", label: "Save title", description: "Save the edited frame title." }),
  policy({ id: "cancel-frame-title-edit", scopes: ["frame-title-edit"], bindings: [primary("Escape", [], "native")], guards: [failedGuard("target", "editable", "frame-not-editable", "Snapshot frame titles cannot be changed.")], consequence: "standard", label: "Cancel title edit", description: "Discard the edited frame title." }),
  policy({ id: "show-frame-breakpoints", scopes: ["canvas"], bindings: [], guards: [failedGuard("target", "frameIsLive", "frame-not-live", "Snapshot frames cannot be duplicated as live breakpoints.")], consequence: "standard", label: "Create breakpoints", description: "Duplicate this live page at every missing standard viewport size." }),
  policy({ id: "take-frame-snapshot", scopes: ["canvas"], bindings: [], guards: [failedGuard("target", "snapshotAvailable", "snapshot-unavailable", "Snapshot capture is not available for this frame.")], consequence: "standard", label: "Take snapshot", description: "Preserve the live page as a separate immutable snapshot frame." }),
  policy({ id: "open-frame-new-tab", scopes: ["canvas", "menu"], bindings: [], consequence: "standard", label: "Open in new tab", description: "Open this frame's page in a separate browser tab." }),
  policy({ id: "enter-frame-fullscreen", scopes: ["canvas", "menu"], bindings: [], consequence: "standard", label: "Enter fullscreen", description: "Expand this frame to fill the screen for focused review." }),
  policy({ id: "exit-frame-fullscreen", scopes: ["fullscreen", "menu"], bindings: [primary("Escape", [], "native")], consequence: "standard", label: "Exit fullscreen", description: "Return this frame to its position on the canvas." }),
  policy({ id: "open-frame-size-menu", scopes: ["menu"], bindings: [], consequence: "standard", label: "Choose size", description: "Choose a standard viewport size for this frame." }),
  policy({ id: "resize-frame-to-preset", scopes: ["menu"], bindings: [], consequence: "standard", label: "Resize to {presetLabel}", description: "Resize this frame to the {presetLabelLower} preset at {width} by {height} pixels." }),
  policy({ id: "open-frame-duplicate-menu", scopes: ["menu"], bindings: [], guards: [failedGuard("target", "frameIsLive", "frame-not-live", "Snapshot frames cannot be duplicated as live frames.", "hidden")], consequence: "standard", label: "Choose duplicate size", description: "Create another live Frame at a standard viewport size." }),
  policy({ id: "duplicate-frame-at-preset", scopes: ["menu"], bindings: [], guards: [failedGuard("target", "frameIsLive", "frame-not-live", "Snapshot frames cannot be duplicated as live frames.", "hidden")], consequence: "standard", label: "Duplicate at {presetLabel}", description: "Duplicate this frame at the {presetLabelLower} preset." }),
  policy({ id: "fit-frame-content", scopes: ["menu"], bindings: [], consequence: "standard", label: "Fit frame content", description: "Resize the frame height to fit its same-origin page content." })
]

const commentThreadPolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "place-comment", scopes: ["canvas"], bindings: [], guards: [failedGuard("target", "frameIsLive", "frame-not-live", "Archived Frames do not support comments.", "hidden")], consequence: "standard", label: "Place comment", description: "Place a comment at this location in the live frame." }),
  policy({ id: "open-comment", scopes: ["canvas"], bindings: [], consequence: "standard", label: "Open comment", description: "Open this comment thread for review." }),
  policy({ id: "close-comment", scopes: ["comment-compose", "comment-edit"], bindings: [], consequence: "standard", label: "Close comment", description: "Close this comment without changing it." }),
  policy({ id: "begin-comment-edit", scopes: ["comment-edit"], bindings: [], guards: [failedGuard("target", "editable", "comment-not-editable", "Only the Comment Author may edit it.", "hidden")], consequence: "standard", label: "Edit comment", description: "Edit this comment message." }),
  policy({ id: "cancel-comment-edit", scopes: ["comment-edit"], bindings: [], guards: [failedGuard("target", "editable", "comment-not-editable", "Only the Comment Author may edit it.", "hidden")], consequence: "standard", label: "Cancel", description: "Discard the edited comment text." }),
  policy({ id: "save-comment-edit", scopes: ["comment-edit"], bindings: [primary("Enter", ["mod"], "native")], guards: [failedGuard("target", "editable", "comment-not-editable", "Only the Comment Author may edit it.", "hidden"), failedGuard("target", "bodyPresent", "empty-comment", "Enter comment text before saving.")], consequence: "standard", label: "Save comment", description: "Save the edited comment text." }),
  policy({ id: "submit-comment", scopes: ["comment-compose"], bindings: [primary("Enter", ["mod"], "native")], guards: [failedGuard("target", "bodyPresent", "empty-comment", "Enter comment text before submitting.")], consequence: "standard", label: "Submit comment", description: "Submit this feedback on the frame." }),
  policy({ id: "submit-reply", scopes: ["comment-compose"], bindings: [primary("Enter", ["mod"], "native")], guards: [failedGuard("target", "bodyPresent", "empty-comment", "Enter reply text before submitting.")], consequence: "standard", label: "Submit reply", description: "Add this reply to the comment thread." }),
  policy({ id: "resolve-comment-thread", scopes: ["comment-compose"], bindings: [], guards: [failedGuard("target", "manageable", "comment-thread-not-manageable", "Only the Canvas Owner or Thread Author may resolve it.", "hidden")], consequence: "standard", label: "Resolve comment thread", description: "Mark this comment thread as resolved." }),
  policy({ id: "reopen-comment-thread", scopes: ["comment-compose"], bindings: [], guards: [failedGuard("target", "manageable", "comment-thread-not-manageable", "Only the Canvas Owner or Thread Author may reopen it.", "hidden")], consequence: "standard", label: "Reopen comment thread", description: "Reopen this resolved comment thread." })
]

const menuPolicies: ReadonlyArray<CanvasActionPolicy> = [
  policy({ id: "close-context-menu", scopes: ["menu"], bindings: [primary("Escape")], consequence: "standard", label: "Close menu", description: "Close the current action menu." })
]

export const CANVAS_ACTION_POLICIES: ReadonlyArray<CanvasActionPolicy> = [
  ...canvasPolicies,
  ...arrangementPolicies,
  ...canvasTitlePolicies,
  ...newFrameFormPolicies,
  ...itemPolicies,
  ...framePolicies,
  ...commentThreadPolicies,
  ...menuPolicies
]

const statusLabels = {
  "in-progress": "In progress",
  "ready-for-review": "Ready for review",
  approved: "Approved",
  "changes-requested": "Changes requested",
  archived: "Archived"
} as const

const presetDetails = {
  mobile: { label: "Mobile", width: 402, height: 874 },
  tablet: { label: "Tablet", width: 832, height: 1194 },
  laptop: { label: "Laptop", width: 1280, height: 832 },
  desktop: { label: "Desktop", width: 1512, height: 982 },
  widescreen: { label: "Widescreen", width: 2560, height: 1440 }
} as const

const alignmentDetails = {
  left: { label: "left", description: "left edge" },
  "horizontal-center": { label: "horizontal center", description: "horizontal center" },
  right: { label: "right", description: "right edge" },
  top: { label: "top", description: "top edge" },
  "vertical-center": { label: "vertical center", description: "vertical center" },
  bottom: { label: "bottom", description: "bottom edge" }
} as const

export const ALLOWED_CANVAS_CONTROL_SCOPE_SETS: ReadonlyArray<ReadonlyArray<CanvasControlScope>> = [
  ["canvas"],
  ["canvas", "menu"],
  ["canvas", "arrangement-menu"],
  ["canvas", "canvas-title-edit"],
  ["canvas", "new-frame-form"],
  ["canvas", "frame-title-edit"],
  ["canvas", "comment-compose"],
  ["canvas", "comment-edit"],
  ["canvas", "fullscreen"],
  ["menu"],
  ["arrangement-menu"]
]

const normalizedScopeSet = (scopes: ReadonlyArray<CanvasControlScope>) =>
  [...new Set(scopes)].sort().join("|")

const bindingKey = (binding: CanvasActionBinding) =>
  [...binding.modifiers].sort().join("+") + ":" + binding.key.toLowerCase()

const actionTargetOf = (request: CanvasActionRequest) =>
  "target" in request ? request.target : null

type CanvasPropertySource =
  | CanvasActionRequest
  | ReturnType<typeof templateValues>

const propertyValue = <Key extends PropertyKey>(
  value: CanvasPropertySource,
  key: Key
): boolean | string | undefined => {
  if (!Predicate.hasProperty(value, key)) return undefined
  const candidate = value[key]
  return Predicate.isBoolean(candidate) || Predicate.isString(candidate)
    ? candidate
    : undefined
}

const booleanFact = (
  request: CanvasActionRequest,
  fact: string,
  source: "request" | "target"
) => {
  const value = propertyValue(request, fact)
  if (Predicate.isBoolean(value)) return value
  throw new TypeError(
    `Action ${request.id} does not supply ${source} fact ${fact}`
  )
}

export const canvasActionKey = (request: CanvasActionRequest) => {
  const target = actionTargetOf(request)
  if (target !== null) return `${request.id}:${target.kind}:${target.id}`
  if ("alignment" in request) return `${request.id}:${request.alignment}`
  if ("axis" in request) return `${request.id}:${request.axis}`
  return request.id
}

const factValue = (
  request: CanvasActionRequest,
  state: CanvasControlState,
  guard: Guard
) => {
  const requirement = guard.requirement
  const target = actionTargetOf(request)
  if (
    guard.targetKinds !== undefined &&
    (target === null || !guard.targetKinds.includes(target.kind))
  ) return requirement.equals
  return Match.value(requirement).pipe(
    Match.discriminatorsExhaustive("source")({
      global: () => state.globalFacts.commentAuthorPresent,
      execution: () => state.pendingActions.includes(canvasActionKey(request)),
      request: (requestRequirement) =>
        booleanFact(request, requestRequirement.fact, "request"),
      target: (targetRequirement) =>
        booleanFact(request, targetRequirement.fact, "target")
    })
  )
}

const templateValues = (request: CanvasActionRequest) => {
  const preset = "preset" in request ? presetDetails[request.preset] : undefined
  const status = "status" in request ? statusLabels[request.status] : undefined
  const alignment = "alignment" in request
    ? alignmentDetails[request.alignment]
    : undefined
  const distributionAxis = "axis" in request ? request.axis : undefined
  return {
    targetKind: actionTargetOf(request)?.kind === "comment-thread"
      ? "comment thread"
      : actionTargetOf(request)?.kind ?? "",
    statusLabel: status ?? "",
    presetLabel: preset?.label ?? "",
    presetLabelLower: preset?.label.toLowerCase() ?? "",
    width: preset?.width.toString() ?? "",
    height: preset?.height.toString() ?? "",
    alignmentLabel: alignment?.label ?? "",
    alignmentDescription: alignment?.description ?? "",
    distributionAxisLabel: distributionAxis === "horizontal"
      ? "horizontally"
      : distributionAxis === "vertical" ? "vertically" : "",
    distributionGapLabel: distributionAxis === "horizontal"
      ? "horizontal"
      : distributionAxis === "vertical" ? "vertical" : ""
  }
}

const emptyTemplateValues: ReturnType<typeof templateValues> = {
  targetKind: "",
  statusLabel: "",
  presetLabel: "",
  presetLabelLower: "",
  width: "",
  height: "",
  alignmentLabel: "",
  alignmentDescription: "",
  distributionAxisLabel: "",
  distributionGapLabel: ""
}

const interpolate = (
  template: string,
  values: ReturnType<typeof templateValues>
) => template.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => {
  const value = propertyValue(values, key)
  if (Predicate.isString(value)) return value
  throw new TypeError(`Unknown Canvas action template value: ${key}`)
})

const resolvedPlatform = (platform: CanvasControlPlatform) =>
  platform === "unknown" ? "macos" : platform

const modifierNames = (
  platform: CanvasControlPlatform,
  modifier: typeof SemanticModifier.Type
) => modifier === "mod"
  ? resolvedPlatform(platform) === "macos" ? "Meta" : "Control"
  : modifier === "shift" ? "Shift" : "Alt"

const displayBinding = (
  binding: CanvasActionBinding,
  platform: CanvasControlPlatform
) => {
  const actualPlatform = resolvedPlatform(platform)
  const modifiers = binding.modifiers.map((modifier) =>
    modifier === "mod"
      ? actualPlatform === "macos" ? "⌘" : "Ctrl"
      : modifier === "shift" ? actualPlatform === "macos" ? "⇧" : "Shift"
        : actualPlatform === "macos" ? "⌥" : "Alt"
  )
  const key = binding.key === "Backspace"
    ? "Del"
    : binding.key === "Escape" ? "Esc" : binding.key
  return actualPlatform === "macos"
    ? `${modifiers.join("")}${key}`
    : [...modifiers, key].join("+")
}

const ariaBinding = (
  binding: CanvasActionBinding,
  platform: CanvasControlPlatform
) => [
  ...binding.modifiers.map((modifier) => modifierNames(platform, modifier)),
  binding.key
].join("+")

const validatePolicies = (policies: ReadonlyArray<CanvasActionPolicy>) => {
  const counts = new Map<CanvasActionId, number>()
  for (const declaration of policies) {
    counts.set(declaration.id, (counts.get(declaration.id) ?? 0) + 1)
    if (/\{target(?:Label|Kind)\}/.test(declaration.label)) {
      throw new TypeError(
        `Canvas action ${declaration.id} title must not interpolate target data`
      )
    }
    interpolate(declaration.label, emptyTemplateValues)
    interpolate(declaration.description, emptyTemplateValues)
  }
  for (const id of actionIds) {
    if (counts.get(id) !== 1) {
      throw new TypeError(`Canvas action ${id} must have exactly one policy declaration`)
    }
  }
  for (const scopes of ALLOWED_CANVAS_CONTROL_SCOPE_SETS) {
    const seen = new Map<string, CanvasActionId>()
    for (const declaration of policies) {
      if (!declaration.scopes.some((scope) => scopes.includes(scope))) continue
      for (const binding of declaration.bindings) {
        if (binding.delivery !== "registered") continue
        const key = bindingKey(binding)
        const previous = seen.get(key)
        if (previous !== undefined && previous !== declaration.id) {
          throw new TypeError(
            `Canvas shortcut conflict in ${normalizedScopeSet(scopes)}: ${previous} and ${declaration.id} use ${key}`
          )
        }
        seen.set(key, declaration.id)
      }
    }
  }
}

export type CanvasControlsInstance = {
  readonly action: (request: CanvasActionRequest) => ResolvedCanvasAction
  readonly invoke: <A, E, R>(
    action: ResolvedCanvasAction,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | CanvasActionUnavailable, R>
}

export type CanvasControlResolver = {
  readonly resolve: (input: CanvasControlState) => CanvasControlsInstance
}

export const makeCanvasControls = (
  declarations: ReadonlyArray<CanvasActionPolicy> = CANVAS_ACTION_POLICIES
): CanvasControlResolver => {
  const policies = declarations
  validatePolicies(policies)
  const byId = new Map(policies.map((declaration) => [declaration.id, declaration]))

  return {
    resolve: (input) => {
      const state = Schema.decodeUnknownSync(CanvasControlState)(input)
      const activeScopes = normalizedScopeSet(state.activeScopes)
      if (!ALLOWED_CANVAS_CONTROL_SCOPE_SETS.some(
        (allowed) => normalizedScopeSet(allowed) === activeScopes
      )) {
        throw new TypeError(`Unsupported active Canvas control scopes: ${activeScopes}`)
      }
      return {
        action: (unparsedRequest) => {
          const request = Schema.decodeUnknownSync(CanvasActionRequest)(unparsedRequest)
          const declaration = byId.get(request.id)!
          const values = templateValues(request)
          const failed = declaration.guards.find((guard) =>
            factValue(request, state, guard) !== guard.requirement.equals
          )
          const bindings = declaration.scopes.some((scope) =>
            state.activeScopes.includes(scope)
          ) ? declaration.bindings : []
          const primaryBinding = bindings.find((binding) => binding.role === "primary")
          const target = actionTargetOf(request)
          const commonAction = {
            key: canvasActionKey(request),
            id: request.id,
            target,
            label: interpolate(declaration.label, values),
            description: interpolate(declaration.description, values),
            consequence: declaration.consequence,
            shortcut: primaryBinding === undefined
              ? null
              : displayBinding(primaryBinding, state.platform),
            ariaKeyShortcuts: bindings.length === 0
              ? null
              : bindings
                  .map((binding) => ariaBinding(binding, state.platform))
                  .join(" "),
            bindings
          }
          return failed === undefined
            ? Schema.decodeUnknownSync(ResolvedCanvasAction)({
                ...commonAction,
                availability: "enabled"
              })
            : Schema.decodeUnknownSync(ResolvedCanvasAction)({
                ...commonAction,
                availability: failed.onFailure.state,
                reason: failed.onFailure.reason,
                availabilityMessage: failed.onFailure.message
              })
        },
        invoke: (action, effect) => action.availability === "enabled"
          ? effect
          : Effect.fail(new CanvasActionUnavailable({
              actionKey: action.key,
              actionId: action.id,
              availability: action.availability,
              reason: action.reason
            }))
      }
    }
  }
}

export const CanvasControls = makeCanvasControls()

export const canvasControlPlatform = (
  platform = defaultRuntimeCapabilities.platform()
): CanvasControlPlatform => /Mac|iPhone|iPad|iPod/i.test(platform)
  ? "macos"
  : /Win/i.test(platform) ? "windows"
    : /Linux|X11/i.test(platform) ? "linux" : "unknown"

export const tanStackHotkeysForAction = (
  action: ResolvedCanvasAction
): ReadonlyArray<{
  readonly key: string
  readonly mod: boolean
  readonly shift: boolean
  readonly alt: boolean
}> => action.bindings
  .filter((binding) => binding.delivery === "registered")
  .map((binding) => ({
    key: binding.key,
    mod: binding.modifiers.includes("mod"),
    shift: binding.modifiers.includes("shift"),
    alt: binding.modifiers.includes("alt")
  }))
