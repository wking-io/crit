import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { FileSystemAgentActivity } from "../../src/node/file-system-agent-activity.js"
import { AgentActivityStore } from "../../src/runtime/agent-activity.js"

describe("FileSystemAgentActivity", () => {
  let root = ""
  let time = new Date("2026-08-08T12:00:00.000Z")

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-agent-activity-"))
    time = new Date("2026-08-08T12:00:00.000Z")
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.effect("renews, expires, and clears independent Agent Activities", () =>
    Effect.gen(function*() {
      const store = yield* AgentActivityStore
      const activityFile = (activityId: string) =>
        path.join(root, ".crit/activity/review", `${activityId}.json`)
      const exists = (activityId: string) =>
        Effect.promise(() =>
          access(activityFile(activityId)).then(
            () => true,
            () => false
          )
        )

      expect(yield* store.read("review")).toEqual({
        schemaVersion: 1,
        canvasId: "review",
        activities: []
      })

      const first = yield* store.signal({
        canvasId: "review",
        activityId: "codex-1",
        harness: "Codex",
        model: "GPT-5",
        detail: "Implementing checkout",
        reference: {
          kind: "thread",
          id: "thread-1",
          uri: "codex://threads/thread-1"
        }
      })
      expect(first).toMatchObject({
        activityId: "codex-1",
        createdAt: "2026-08-08T12:00:00.000Z",
        activeUntil: "2026-08-08T12:01:00.000Z"
      })

      time = new Date("2026-08-08T12:00:20.000Z")
      yield* store.signal({
        canvasId: "review",
        activityId: "claude-1",
        harness: "Claude",
        model: null,
        detail: "Reviewing copy",
        reference: null
      })
      expect((yield* store.read("review")).activities).toHaveLength(2)

      time = new Date("2026-08-08T12:00:30.000Z")
      const renewed = yield* store.signal({
        canvasId: "review",
        activityId: "codex-1",
        harness: "Codex",
        model: null,
        detail: "Polishing checkout",
        reference: null
      })
      expect(renewed).toMatchObject({
        createdAt: "2026-08-08T12:00:00.000Z",
        updatedAt: "2026-08-08T12:00:30.000Z",
        activeUntil: "2026-08-08T12:01:30.000Z",
        model: null,
        reference: null,
        detail: "Polishing checkout"
      })

      time = new Date("2026-08-08T12:01:21.000Z")
      const remaining = yield* store.read("review")
      expect(remaining.activities.map((activity) => activity.activityId)).toEqual([
        "codex-1"
      ])
      expect(yield* exists("claude-1")).toBe(false)

      yield* store.clear("review", "codex-1")
      expect(yield* exists("codex-1")).toBe(false)
      expect((yield* store.read("review")).activities).toEqual([])
    }).pipe(
      Effect.provide(
        FileSystemAgentActivity.layer({ root, now: () => time })
      )
    ))

  it.effect("correlates signal failures with the activity identity", () =>
    Effect.gen(function*() {
      const store = yield* AgentActivityStore
      const failure = yield* Effect.flip(store.signal({
        canvasId: "review",
        activityId: " ",
        harness: "Codex",
        model: null,
        detail: null,
        reference: null
      }))

      expect(failure).toMatchObject({
        _tag: "AgentActivitySignalFailed",
        canvasId: "review",
        activityId: " "
      })
      expect("operation" in failure).toBe(false)
    }).pipe(
      Effect.provide(
        FileSystemAgentActivity.layer({ root, now: () => time })
      )
    ))

  it.effect("normalizes an omitted reference URI in version 1 records", () =>
    Effect.gen(function*() {
      const directory = path.join(root, ".crit/activity/review")
      yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      yield* Effect.promise(() => writeFile(
        path.join(directory, "legacy.json"),
        JSON.stringify({
          schemaVersion: 1,
          canvasId: "review",
          activityId: "legacy",
          harness: "Codex",
          model: null,
          detail: null,
          reference: { kind: "thread", id: "thread-1" },
          createdAt: "2026-08-08T12:00:00.000Z",
          updatedAt: "2026-08-08T12:00:00.000Z",
          activeUntil: "2026-08-08T12:01:00.000Z"
        })
      ))

      const store = yield* AgentActivityStore
      const collection = yield* store.read("review")

      expect(collection.activities[0]?.reference).toEqual({
        kind: "thread",
        id: "thread-1",
        uri: null
      })
    }).pipe(
      Effect.provide(
        FileSystemAgentActivity.layer({ root, now: () => time })
      )
    ))
})
