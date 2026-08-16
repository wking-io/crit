import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Layer, Schema } from "effect"

import {
  AGENT_ACTIVITY_LEASE_SECONDS,
  AgentActivity,
  AgentActivityClearFailed,
  AgentActivityReference,
  AgentActivityReadFailed,
  AgentActivitySignalFailed,
  AgentActivityStore,
  type AgentActivityCollection,
  type SignalAgentActivityInput
} from "../runtime/agent-activity.js"
import { causeMessage } from "../internal/cause-message.js"
import { hasNodeErrorCode } from "./internal/node-error.js"

const ACTIVITY_DIRECTORY = ".crit/activity"

export interface FileSystemAgentActivityOptions {
  readonly root: string
  readonly now?: () => Date
}

const failureDetail = (cause: unknown) =>
  causeMessage(cause)

const required = (value: string, label: string) => {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${label} cannot be empty`)
  return trimmed
}

const nullableText = (value: string | null) => {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

const make = (
  options: FileSystemAgentActivityOptions
): AgentActivityStore["Service"] => {
  const directory = path.join(options.root, ACTIVITY_DIRECTORY)
  const now = options.now ?? (() => new Date())
  const directoryFor = (canvasId: string) =>
    path.join(directory, encodeURIComponent(canvasId))
  const targetFor = (canvasId: string, activityId: string) =>
    path.join(directoryFor(canvasId), `${encodeURIComponent(activityId)}.json`)

  const removeFile = async (canvasId: string, activityId: string) => {
    try {
      await unlink(targetFor(canvasId, activityId))
    } catch (cause) {
      if (!hasNodeErrorCode(cause, "ENOENT")) throw cause
    }
  }

  const readStored = async (canvasId: string, activityId: string) => {
    try {
      const source = await readFile(targetFor(canvasId, activityId), "utf8")
      const decoded = Schema.decodeUnknownSync(AgentActivity)(
        JSON.parse(source)
      )
      if (decoded.canvasId !== canvasId || decoded.activityId !== activityId) {
        throw new Error("Agent Activity identity does not match its path")
      }
      return decoded
    } catch (cause) {
      if (hasNodeErrorCode(cause, "ENOENT")) return undefined
      throw cause
    }
  }

  const write = async (activity: AgentActivity) => {
    const targetDirectory = directoryFor(activity.canvasId)
    await mkdir(targetDirectory, { recursive: true })
    const target = targetFor(activity.canvasId, activity.activityId)
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(activity)}\n`, { mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  const read = (canvasId: string) =>
    Effect.tryPromise({
      try: async (): Promise<AgentActivityCollection> => {
        let entries
        try {
          entries = await readdir(directoryFor(canvasId), { withFileTypes: true })
        } catch (cause) {
          if (hasNodeErrorCode(cause, "ENOENT")) {
            return { schemaVersion: 1, canvasId, activities: [] }
          }
          throw cause
        }
        const currentTime = now().getTime()
        const activities: Array<AgentActivity> = []
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue
          const encodedId = entry.name.slice(0, -".json".length)
          const activityId = decodeURIComponent(encodedId)
          const activity = await readStored(canvasId, activityId)
          if (activity === undefined) continue
          if (Date.parse(activity.activeUntil) <= currentTime) {
            await removeFile(canvasId, activityId)
            continue
          }
          activities.push(activity)
        }
        activities.sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.activityId.localeCompare(right.activityId)
        )
        return { schemaVersion: 1, canvasId, activities }
      },
      catch: (cause) =>
        new AgentActivityReadFailed({
          canvasId,
          detail: failureDetail(cause)
        })
    })

  const signal = (input: SignalAgentActivityInput) =>
    Effect.tryPromise({
      try: async () => {
        const canvasId = required(input.canvasId, "Canvas ID")
        const activityId = required(input.activityId, "Activity ID")
        const harness = required(input.harness, "Harness name")
        const reference = input.reference === null
          ? null
          : {
              kind: required(input.reference.kind, "Reference kind"),
              id: required(input.reference.id, "Reference ID"),
              uri: input.reference.uri === null
                ? null
                : required(input.reference.uri, "Reference URI")
            }
        if (reference !== null) {
          Schema.decodeUnknownSync(AgentActivityReference)(reference)
        }
        const existing = await readStored(canvasId, activityId)
        const updatedAt = now()
        const activity: AgentActivity = {
          schemaVersion: 1,
          canvasId,
          activityId,
          harness,
          model: nullableText(input.model),
          detail: nullableText(input.detail),
          reference,
          createdAt: existing?.createdAt ?? updatedAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          activeUntil: new Date(
            updatedAt.getTime() + AGENT_ACTIVITY_LEASE_SECONDS * 1_000
          ).toISOString()
        }
        await write(activity)
        return activity
      },
      catch: (cause) =>
        new AgentActivitySignalFailed({
          canvasId: input.canvasId,
          activityId: input.activityId,
          detail: failureDetail(cause)
        })
    })

  return {
    read,
    signal,
    clear: (canvasId, activityId) =>
      Effect.tryPromise({
        try: () => removeFile(canvasId, activityId),
        catch: (cause) =>
          new AgentActivityClearFailed({
            canvasId,
            activityId,
            detail: failureDetail(cause)
          })
      })
  }
}

const layer = (options: FileSystemAgentActivityOptions) =>
  Layer.succeed(AgentActivityStore, make(options))

export const FileSystemAgentActivity = { make, layer } as const
