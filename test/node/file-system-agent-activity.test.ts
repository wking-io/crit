import { access, mkdtemp, rm } from "node:fs/promises"
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

  it.effect("signals, expires, and removes ephemeral Canvas activity", () =>
    Effect.gen(function*() {
      const activity = yield* AgentActivityStore
      const activityFile = path.join(root, ".crit/activity/review.json")
      const activityFileExists = () =>
        Effect.promise(() =>
          access(activityFile).then(
            () => true,
            () => false
          )
        )
      expect(yield* activity.read("review")).toMatchObject({ active: false })

      const signaled = yield* activity.signal({
        canvasId: "review",
        activeForSeconds: 30,
        detail: "Implementing checkout"
      })
      expect(signaled).toMatchObject({
        active: true,
        activeUntil: "2026-08-08T12:00:30.000Z",
        detail: "Implementing checkout"
      })
      expect(yield* activityFileExists()).toBe(true)

      time = new Date("2026-08-08T12:00:31.000Z")
      expect(yield* activity.read("review")).toMatchObject({ active: false })
      expect(yield* activityFileExists()).toBe(false)

      yield* activity.signal({
        canvasId: "review",
        activeForSeconds: 30,
        detail: "Implementing checkout"
      })
      expect(yield* activity.clear("review")).toEqual({
        schemaVersion: 1,
        canvasId: "review",
        active: false,
        updatedAt: null,
        activeUntil: null,
        detail: null
      })
      expect(yield* activityFileExists()).toBe(false)
    }).pipe(
      Effect.provide(
        FileSystemAgentActivity.layer({ root, now: () => time })
      )
    ))
})
