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
  zIndex: 1
}

describe("Note editing", () => {
  it("composes an Author edit and measured height as one command batch", () => {
    expect(noteEditingCommands(note, "author", {
      text: "Edited",
      width: 320,
      height: 202
    })).toEqual([
      {
        _tag: "EditNote",
        id: "feedback",
        actorId: "author",
        expectedText: "Original",
        text: "Edited"
      },
      {
        _tag: "ResizeNote",
        id: "feedback",
        width: 320,
        height: 202
      }
    ])
  })

  it("allows height correction without granting text ownership", () => {
    expect(noteEditingCommands(note, "collaborator", {
      text: "Unauthorized edit",
      width: 280,
      height: 190
    })).toEqual([{
      _tag: "ResizeNote",
      id: "feedback",
      width: 280,
      height: 190
    }])
  })

  it("commits once after the fixed idle and flushes immediately on blur", () => {
    let scheduled: (() => void) | undefined
    let delay = 0
    const timer = {} as ReturnType<typeof globalThis.setTimeout>
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

    session.schedule({ text: "First", width: 280, height: 180 })
    session.schedule({ text: "Latest", width: 280, height: 200 })
    expect(delay).toBe(NOTE_EDIT_IDLE_MS)
    expect(batches).toEqual([])

    scheduled?.()
    expect(batches).toHaveLength(1)
    expect(batches[0]?.map((command) => command._tag)).toEqual([
      "EditNote",
      "ResizeNote"
    ])
    expect(batches[0]?.[0]).toMatchObject({ text: "Latest" })

    session.flush({ text: "Latest", width: 280, height: 200 })
    expect(batches).toHaveLength(1)

    session.flush({ text: "Blurred", width: 280, height: 220 })
    expect(batches).toHaveLength(2)
    expect(batches[1]?.[0]).toMatchObject({ text: "Blurred" })

    session.schedule({ text: "Blurred", width: 280, height: 220 })
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
    session.flush({ text: "Local draft", width: 280, height: 180 })

    expect(batches[0]?.[0]).toMatchObject({
      _tag: "EditNote",
      expectedText: "Original",
      text: "Local draft"
    })
  })

  it("does not schedule unchanged content or subpixel height noise", () => {
    let scheduled = false
    const session = createNoteEditingSession({
      actorId: "author",
      commit: () => {},
      note,
      setTimer: () => {
        scheduled = true
        return {} as ReturnType<typeof globalThis.setTimeout>
      }
    })

    session.schedule({ text: "Original", width: 280, height: 160.5 })
    expect(scheduled).toBe(false)
  })
})
