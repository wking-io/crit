import { describe, expect, it } from "vitest"

import type { CanvasCommand, CanvasNote } from "../../src/core/index.js"
import {
  NOTE_EDIT_IDLE_MS,
  createNoteEditingSession,
  noteEditingCommands
} from "../../src/react/note-editing.js"

const note: CanvasNote = {
  id: "feedback",
  text: "Original",
  author: { id: "author", name: "Test Author" },
  geometry: { x: 40, y: 60, width: 280, height: 160 },
  attachedTo: null,
  zIndex: 1,
  color: "blue"
}

describe("Note editing", () => {
  it("commits Author text without persisting presentation dimensions", () => {
    expect(noteEditingCommands(note, "author", {
      text: "Edited"
    })).toEqual([
      {
        _tag: "EditNote",
        id: "feedback",
        actorId: "author",
        expectedText: "Original",
        text: "Edited"
      }
    ])
  })

  it("does not grant text ownership to collaborators", () => {
    expect(noteEditingCommands(note, "collaborator", {
      text: "Unauthorized edit"
    })).toEqual([])
  })

  it("commits once after the fixed idle and flushes immediately on blur", () => {
    let scheduled: (() => void) | undefined
    let delay = 0
    const timer = { cancel: () => {} }
    const batches: Array<ReadonlyArray<CanvasCommand>> = []
    const session = createNoteEditingSession({
      actorId: "author",
      commit: (...commands) => batches.push(commands),
      note,
      setTimer: (callback, nextDelay) => {
        scheduled = callback
        delay = nextDelay
        return timer
      },
      clearTimer: () => {
        scheduled = undefined
      }
    })

    session.schedule({ text: "First" })
    session.schedule({ text: "Latest" })
    expect(delay).toBe(NOTE_EDIT_IDLE_MS)
    expect(batches).toEqual([])

    scheduled?.()
    expect(batches).toHaveLength(1)
    expect(batches[0]?.map((command) => command._tag)).toEqual(["EditNote"])
    expect(batches[0]?.[0]).toMatchObject({ text: "Latest" })

    session.flush({ text: "Latest" })
    expect(batches).toHaveLength(1)

    session.flush({ text: "Blurred" })
    expect(batches).toHaveLength(2)
    expect(batches[1]?.[0]).toMatchObject({ text: "Blurred" })

    session.schedule({ text: "Blurred" })
    expect(scheduled).toBeUndefined()
    expect(batches).toHaveLength(2)
  })

  it("preserves the conflict baseline when remote text arrives before measurement", () => {
    const batches: Array<ReadonlyArray<CanvasCommand>> = []
    const session = createNoteEditingSession({
      actorId: "author",
      commit: (...commands) => batches.push(commands),
      note
    })

    session.synchronize({ ...note, text: "Remote edit" }, "Local draft")
    session.flush({ text: "Local draft" })

    expect(batches[0]?.[0]).toMatchObject({
      _tag: "EditNote",
      expectedText: "Original",
      text: "Local draft"
    })
  })

  it("does not schedule unchanged content", () => {
    let scheduled = false
    const session = createNoteEditingSession({
      actorId: "author",
      commit: () => {},
      note,
      setTimer: () => {
        scheduled = true
        return { cancel: () => {} }
      }
    })

    session.schedule({ text: "Original" })
    expect(scheduled).toBe(false)
  })
})
