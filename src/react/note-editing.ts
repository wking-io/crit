import {
  CanvasCommand,
  type CanvasCommand as CanvasCommandValue,
  type CanvasNote
} from "../core/index.js"

export const NOTE_EDIT_IDLE_MS = 150

export interface NoteDraft {
  readonly text: string
}

export type NoteCommandCommit = (
  ...commands: ReadonlyArray<CanvasCommandValue>
) => void

export interface NoteEditingTimer {
  readonly cancel: () => void
}

const setNoteEditingTimer = (
  callback: () => void,
  delay: number
): NoteEditingTimer => {
  const handle = globalThis.setTimeout(callback, delay)
  return { cancel: () => globalThis.clearTimeout(handle) }
}

export const noteEditingCommands = (
  note: Pick<CanvasNote, "id" | "text" | "author">,
  actorId: string | null,
  draft: NoteDraft
): ReadonlyArray<CanvasCommandValue> => {
  const textChanged = draft.text !== note.text

  if (textChanged && actorId === note.author.id) {
    return [CanvasCommand.editNote({
      id: note.id,
      actorId,
      expectedText: note.text,
      text: draft.text
    })]
  }

  return []
}

export const createNoteEditingSession = ({
  actorId,
  commit,
  note,
  setTimer = setNoteEditingTimer,
  clearTimer = (timer) => timer.cancel()
}: {
  readonly actorId: string | null
  readonly commit: NoteCommandCommit
  readonly note: CanvasNote
  readonly setTimer?: (callback: () => void, delay: number) => NoteEditingTimer
  readonly clearTimer?: (timer: NoteEditingTimer) => void
}) => {
  let baseline = note
  let latest: NoteDraft = { text: note.text }
  let committed: NoteDraft | undefined
  let timer: NoteEditingTimer | undefined

  const sameDraft = (
    left: NoteDraft,
    right: NoteDraft
  ) => left.text === right.text

  const cancel = () => {
    if (timer === undefined) return
    clearTimer(timer)
    timer = undefined
  }

  const commitLatest = () => {
    cancel()
    if (committed !== undefined && sameDraft(committed, latest)) return
    const commands = noteEditingCommands(baseline, actorId, latest)
    if (commands.length > 0) {
      committed = latest
      commit(...commands)
    }
  }

  return {
    isTextDirty: (text: string) => text !== baseline.text,
    synchronize: (next: CanvasNote, localText: string) => {
      const authoritativeChanged = next.text !== baseline.text ||
        next.author.id !== baseline.author.id
      const acceptedLocalText = next.text === localText
      const wasClean = localText === baseline.text
      baseline = {
        ...next,
        text: acceptedLocalText || wasClean ? next.text : baseline.text
      }
      if (acceptedLocalText || wasClean) latest = { ...latest, text: next.text }
      if (authoritativeChanged) committed = undefined
    },
    schedule: (draft: NoteDraft) => {
      latest = draft
      cancel()
      if (committed !== undefined && sameDraft(committed, latest)) return
      if (noteEditingCommands(baseline, actorId, latest).length === 0) return
      timer = setTimer(commitLatest, NOTE_EDIT_IDLE_MS)
    },
    flush: (draft: NoteDraft) => {
      latest = draft
      commitLatest()
    },
    dispose: cancel
  } as const
}
