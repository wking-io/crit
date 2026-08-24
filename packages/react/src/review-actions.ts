import {
  AuthoredText,
  type CanvasCommand,
  type CanvasCommandBatch,
  type CanvasProjection,
  type CommentThread,
  type Frame,
  Id,
  type Note,
  type NoteColor,
  type ReviewStatus,
  WebUrlRepresentation,
  proposeAddCommentThread,
  proposeAddFrame,
  proposeAddNote,
  proposeAttachNote,
  proposeBringToFront,
  proposeDetachNote,
  proposeEditComment,
  proposeEditNote,
  proposeRemoveFrame,
  proposeRemoveNote,
  proposeRenameCanvas,
  proposeReplyToCommentThread,
  proposeSendToBack,
  proposeSetCommentThreadResolution,
  proposeSetFrameGeometry,
  proposeSetFrameStatus,
  proposeSetFrameTitle,
  proposeSetNoteColor,
  proposeSetNoteGeometry
} from "@crit/domain"
import { Effect, Option, Schema } from "effect"

import {
  CanvasArrangement,
  type CanvasAlignment,
  type CanvasArrangementOperation
} from "./canvas-arrangement.js"
import type { CanvasSelection } from "./canvas-selection.js"
import { FRAME_SIZE_PRESETS } from "./frame-breakpoints.js"

export type ReviewAction =
  | { readonly _tag: "batch"; readonly commands: CanvasCommandBatch }
  | { readonly _tag: "effect"; readonly effect: ReviewClientEffect }

export type ReviewClientEffect =
  | { readonly _tag: "open-url"; readonly url: string }
  | { readonly _tag: "fullscreen"; readonly target: "frame" | "exit" }
  | { readonly _tag: "copy"; readonly text: string }
  | {
    readonly _tag: "set-preference"
    readonly key: "pause-offscreen"
    readonly value: boolean
  }

export type ReviewSelection =
  | { readonly _tag: "items"; readonly items: CanvasSelection }
  | {
    readonly _tag: "comment-thread"
    readonly threadId: CommentThread["threadId"]
  }

export type ReviewActionInput =
  | { readonly _tag: "none" }
  | { readonly _tag: "text"; readonly text: string }
  | { readonly _tag: "url"; readonly url: string }

export interface ReviewActionContext {
  readonly projection: CanvasProjection
  readonly selection: ReviewSelection
  readonly input: ReviewActionInput
  readonly fullscreen: boolean
  readonly pauseOffscreen: boolean
}

export interface ReviewActionPolicy<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly available: (
    selection: ReviewSelection,
    projection: CanvasProjection
  ) => boolean
  readonly run: (context: ReviewActionContext) => ReviewAction | null
}

const policy = <const Id extends string>(
  value: ReviewActionPolicy<Id>
): ReviewActionPolicy<Id> => value

const itemKey = (value: Frame | Note): string =>
  "frameId" in value ? `frame:${value.frameId}` : `note:${value.noteId}`

const selectedItems = (
  selection: ReviewSelection,
  projection: CanvasProjection
): readonly (Frame | Note)[] => {
  if (selection._tag !== "items") return []
  return selection.items.flatMap((item) => {
    const value = item._tag === "frame"
      ? projection.frames.find((frame) => frame.frameId === item.frameId)
      : projection.notes.find((note) => note.noteId === item.noteId)
    return value === undefined ? [] : [value]
  })
}

const selectedFrame = (
  selection: ReviewSelection,
  projection: CanvasProjection
): Frame | undefined => {
  const items = selectedItems(selection, projection)
  const item = items.length === 1 ? items[0] : undefined
  return item !== undefined && "frameId" in item ? item : undefined
}

const selectedNote = (
  selection: ReviewSelection,
  projection: CanvasProjection
): Note | undefined => {
  const items = selectedItems(selection, projection)
  const item = items.length === 1 ? items[0] : undefined
  return item !== undefined && "noteId" in item ? item : undefined
}

const selectedThread = (
  selection: ReviewSelection,
  projection: CanvasProjection
): CommentThread | undefined =>
  selection._tag === "comment-thread"
    ? projection.threads.find((thread) => thread.threadId === selection.threadId)
    : undefined

const selectedAttachmentPair = (
  selection: ReviewSelection,
  projection: CanvasProjection
): { readonly frame: Frame; readonly note: Note } | undefined => {
  const items = selectedItems(selection, projection)
  if (items.length !== 2) return undefined
  const frame = items.find((item): item is Frame => "frameId" in item)
  const note = items.find((item): item is Note => "noteId" in item)
  return frame === undefined || note === undefined ? undefined : { frame, note }
}

const reviewBatch = (
  commands: readonly CanvasCommand[]
): ReviewAction | null => {
  const [first, ...rest] = commands
  return first === undefined
    ? null
    : { _tag: "batch", commands: [first, ...rest] }
}

const textInput = (input: ReviewActionInput) => {
  if (input._tag !== "text") return undefined
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(AuthoredText)(input.text.trim())
  )
}

const urlInput = (input: ReviewActionInput) => {
  if (input._tag !== "url") return undefined
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(WebUrlRepresentation)({
      _tag: "web-url",
      url: input.url.trim()
    })
  )
}

const randomToken = () => crypto.randomUUID().replaceAll("-", "")
const mintFrameId = () => Id.frame(`frame_${randomToken()}`)
const mintNoteId = () => Id.note(`note_${randomToken()}`)
const mintThreadId = () => Id.commentThread(`thread_${randomToken()}`)
const mintCommentId = () => Id.comment(`comment_${randomToken()}`)

const noInput: ReviewActionInput = { _tag: "none" }

const addFramePolicy = policy({
  id: "add-frame",
  label: "Add frame",
  available: () => true,
  run: ({ input, projection }) => {
    const representation = urlInput(input)
    if (representation === undefined) return null
    const offset = 40 + projection.frames.length * 40
    return reviewBatch([proposeAddFrame({
      frameId: mintFrameId(),
      title: representation.url,
      representation,
      status: "in-progress",
      geometry: { x: offset, y: offset, width: 1280, height: 832 }
    })])
  }
})

const addNotePolicy = policy({
  id: "add-note",
  label: "Add note",
  available: () => true,
  run: ({ input, projection, selection }) => {
    const text = textInput(input)
    if (text === undefined) return null
    const selected = selectedItems(selection, projection)[0]
    const x = selected === undefined ? 40 : selected.geometry.x + 40
    const y = selected === undefined ? 40 : selected.geometry.y + 40
    return reviewBatch([proposeAddNote({
      noteId: mintNoteId(),
      text,
      color: "neutral",
      geometry: { x, y, width: 240, height: 160 },
      attachedFrameId: null
    })])
  }
})

const renameCanvasPolicy = policy({
  id: "rename-canvas",
  label: "Rename canvas",
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
  available: (selection, projection) =>
    selectedItems(selection, projection).length > 0,
  run: ({ projection, selection }) =>
    reviewBatch(selectedItems(selection, projection).map((item) =>
      "frameId" in item ? proposeRemoveFrame(item) : proposeRemoveNote(item)
    ))
})

const bringToFrontPolicy = policy({
  id: "bring-to-front",
  label: "Bring to front",
  available: (selection, projection) =>
    selectedItems(selection, projection).length === 1,
  run: ({ projection, selection }) => {
    const item = selectedItems(selection, projection)[0]
    return item === undefined
      ? null
      : reviewBatch([proposeBringToFront(projection, item)])
  }
})

const sendToBackPolicy = policy({
  id: "send-to-back",
  label: "Send to back",
  available: (selection, projection) =>
    selectedItems(selection, projection).length === 1,
  run: ({ projection, selection }) => {
    const item = selectedItems(selection, projection)[0]
    return item === undefined
      ? null
      : reviewBatch([proposeSendToBack(projection, item)])
  }
})

const setFrameTitlePolicy = policy({
  id: "set-frame-title",
  label: "Set frame title",
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

const editNotePolicy = policy({
  id: "edit-note",
  label: "Edit note",
  available: (selection, projection) =>
    selectedNote(selection, projection) !== undefined,
  run: ({ input, projection, selection }) => {
    const note = selectedNote(selection, projection)
    const text = textInput(input)
    return note === undefined || text === undefined
      ? null
      : reviewBatch([proposeEditNote(note, text)])
  }
})

const attachNotePolicy = policy({
  id: "attach-note",
  label: "Attach note",
  available: (selection, projection) => {
    const pair = selectedAttachmentPair(selection, projection)
    return pair !== undefined && pair.note.attachedFrameId !== pair.frame.frameId
  },
  run: ({ projection, selection }) => {
    const pair = selectedAttachmentPair(selection, projection)
    return pair === undefined
      ? null
      : reviewBatch([proposeAttachNote(pair.note, pair.frame.frameId)])
  }
})

const detachNotePolicy = policy({
  id: "detach-note",
  label: "Detach note",
  available: (selection, projection) =>
    selectedNote(selection, projection)?.attachedFrameId !== null &&
    selectedNote(selection, projection) !== undefined,
  run: ({ projection, selection }) => {
    const note = selectedNote(selection, projection)
    return note === undefined
      ? null
      : reviewBatch([proposeDetachNote(note)])
  }
})

const frameStatusPolicies = ([
  "in-progress",
  "ready-for-review",
  "approved",
  "changes-requested"
] as const satisfies readonly ReviewStatus[]).map((status) => policy({
  id: `set-frame-status-${status}` as const,
  label: `Set status to ${status}`,
  available: (selection, projection) => {
    const frame = selectedFrame(selection, projection)
    return frame !== undefined && frame.status !== status
  },
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame === undefined
      ? null
      : reviewBatch([proposeSetFrameStatus(frame, status)])
  }
}))

const noteColorPolicies = ([
  "neutral",
  "red",
  "orange",
  "green",
  "blue",
  "purple"
] as const satisfies readonly NoteColor[]).map((color) => policy({
  id: `set-note-color-${color}` as const,
  label: `Set note color to ${color}`,
  available: (selection, projection) => {
    const note = selectedNote(selection, projection)
    return note !== undefined && note.color !== color
  },
  run: ({ projection, selection }) => {
    const note = selectedNote(selection, projection)
    return note === undefined
      ? null
      : reviewBatch([proposeSetNoteColor(note, color)])
  }
}))

const arrangementItemId = (item: Frame | Note): string => itemKey(item)

const arrangementAction = (
  context: ReviewActionContext,
  operation: CanvasArrangementOperation
): ReviewAction | null => {
  const selected = selectedItems(context.selection, context.projection)
  const plan = Option.getOrUndefined(Effect.runSync(Effect.option(
    CanvasArrangement.plan({
      operation,
      items: selected.map((item) => ({
        id: arrangementItemId(item),
        ...item.geometry
      }))
    })
  )))
  if (plan === undefined) return null
  const byId = new Map(selected.map((item) => [arrangementItemId(item), item]))
  return reviewBatch(plan.moves.flatMap((move) => {
    const item = byId.get(move.id)
    if (item === undefined) return []
    const geometry = { ...item.geometry, x: move.x, y: move.y }
    return [
      "frameId" in item
        ? proposeSetFrameGeometry(item, geometry)
        : proposeSetNoteGeometry(item, geometry)
    ]
  }))
}

const alignmentPolicy = (alignment: CanvasAlignment) => policy({
  id: `align-${alignment}` as const,
  label: `Align ${alignment}`,
  available: (selection, projection) =>
    selectedItems(selection, projection).length >= 2,
  run: (context) => arrangementAction(context, { _tag: "Align", alignment })
})

const distributionPolicy = (axis: "horizontal" | "vertical") => policy({
  id: `distribute-${axis}` as const,
  label: `Distribute ${axis}`,
  available: (selection, projection) =>
    selectedItems(selection, projection).length >= 3,
  run: (context) => arrangementAction(context, { _tag: "Distribute", axis })
})

const arrangeGridPolicy = policy({
  id: "arrange-grid",
  label: "Arrange grid",
  available: (selection, projection) =>
    selectedItems(selection, projection).length >= 2,
  run: (context) => arrangementAction(context, { _tag: "ArrangeGrid" })
})

const framePresetPolicies = FRAME_SIZE_PRESETS.map((preset) => policy({
  id: `resize-frame-${preset.id}` as const,
  label: `Resize to ${preset.label}`,
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
  available: (selection, projection) =>
    selectedFrame(selection, projection)?.representation._tag === "web-url",
  run: ({ projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    return frame?.representation._tag === "web-url"
      ? {
        _tag: "effect",
        effect: { _tag: "open-url", url: frame.representation.url }
      }
      : null
  }
})

const enterFullscreenPolicy = policy({
  id: "enter-fullscreen",
  label: "Enter fullscreen",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ fullscreen }) => fullscreen
    ? null
    : { _tag: "effect", effect: { _tag: "fullscreen", target: "frame" } }
})

const exitFullscreenPolicy = policy({
  id: "exit-fullscreen",
  label: "Exit fullscreen",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ fullscreen }) => fullscreen
    ? { _tag: "effect", effect: { _tag: "fullscreen", target: "exit" } }
    : null
})

const copyNodeIdPolicy = policy({
  id: "copy-node-id",
  label: "Copy node ID",
  available: (selection, projection) =>
    selectedItems(selection, projection).length === 1,
  run: ({ projection, selection }) => {
    const item = selectedItems(selection, projection)[0]
    if (item === undefined) return null
    return {
      _tag: "effect",
      effect: {
        _tag: "copy",
        text: "frameId" in item ? item.frameId : item.noteId
      }
    }
  }
})

const pauseOffscreenPolicy = policy({
  id: "toggle-pause-offscreen",
  label: "Pause offscreen frames",
  available: () => true,
  run: ({ pauseOffscreen }) => ({
    _tag: "effect",
    effect: {
      _tag: "set-preference",
      key: "pause-offscreen",
      value: !pauseOffscreen
    }
  })
})

const composeCommentPolicy = policy({
  id: "compose-comment",
  label: "Add comment",
  available: (selection, projection) =>
    selectedFrame(selection, projection) !== undefined,
  run: ({ input, projection, selection }) => {
    const frame = selectedFrame(selection, projection)
    const body = textInput(input)
    return frame === undefined || body === undefined
      ? null
      : reviewBatch([proposeAddCommentThread({
        threadId: mintThreadId(),
        commentId: mintCommentId(),
        anchor: {
          _tag: "frame",
          frameId: frame.frameId,
          point: { x: 0.5, y: 0.5 }
        },
        body
      })])
  }
})

const replyCommentPolicy = policy({
  id: "reply-comment",
  label: "Reply",
  available: (selection, projection) =>
    selectedThread(selection, projection) !== undefined,
  run: ({ input, projection, selection }) => {
    const thread = selectedThread(selection, projection)
    const body = textInput(input)
    return thread === undefined || body === undefined
      ? null
      : reviewBatch([proposeReplyToCommentThread(thread, {
        commentId: mintCommentId(),
        body
      })])
  }
})

const editCommentPolicy = policy({
  id: "edit-comment",
  label: "Edit latest comment",
  available: (selection, projection) =>
    selectedThread(selection, projection) !== undefined,
  run: ({ input, projection, selection }) => {
    const thread = selectedThread(selection, projection)
    const body = textInput(input)
    const comment = thread?.comments.at(-1)
    return thread === undefined || comment === undefined || body === undefined
      ? null
      : reviewBatch([proposeEditComment(thread, comment, body)])
  }
})

const threadResolutionPolicy = (resolved: boolean) => policy({
  id: resolved ? "resolve-comment" as const : "reopen-comment" as const,
  label: resolved ? "Resolve" : "Reopen",
  available: (selection, projection) => {
    const thread = selectedThread(selection, projection)
    return thread !== undefined && thread.resolved !== resolved
  },
  run: ({ projection, selection }) => {
    const thread = selectedThread(selection, projection)
    return thread === undefined
      ? null
      : reviewBatch([proposeSetCommentThreadResolution(thread, resolved)])
  }
})

export const reviewActionPolicies = [
  addFramePolicy,
  addNotePolicy,
  renameCanvasPolicy,
  removePolicy,
  bringToFrontPolicy,
  sendToBackPolicy,
  setFrameTitlePolicy,
  editNotePolicy,
  attachNotePolicy,
  detachNotePolicy,
  ...frameStatusPolicies,
  ...noteColorPolicies,
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
  copyNodeIdPolicy,
  pauseOffscreenPolicy,
  composeCommentPolicy,
  replyCommentPolicy,
  editCommentPolicy,
  threadResolutionPolicy(true),
  threadResolutionPolicy(false)
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

export const ReviewActionInput = {
  none: noInput
} as const
