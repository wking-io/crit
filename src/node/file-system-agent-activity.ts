import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { Effect, Layer, Schema } from "effect"

import {
  AgentActivityFailed,
  AgentActivityStatus,
  AgentActivityStore,
  type AgentActivityStoreShape,
  type SignalAgentActivityInput
} from "../runtime/agent-activity.js"

const ACTIVITY_DIRECTORY = ".crit/activity"
const MAX_ACTIVITY_SECONDS = 60 * 60

export interface FileSystemAgentActivityOptions {
  readonly root: string
  readonly now?: () => Date
}

const inactive = (canvasId: string): AgentActivityStatus => ({
  schemaVersion: 1,
  canvasId,
  active: false,
  updatedAt: null,
  activeUntil: null,
  detail: null
})

const failure = (operation: string, canvasId: string, cause: unknown) =>
  new AgentActivityFailed({
    operation,
    canvasId,
    detail: cause instanceof Error ? cause.message : String(cause)
  })

const make = (
  options: FileSystemAgentActivityOptions
): AgentActivityStoreShape => {
  const directory = path.join(options.root, ACTIVITY_DIRECTORY)
  const now = options.now ?? (() => new Date())
  const targetFor = (canvasId: string) =>
    path.join(directory, `${encodeURIComponent(canvasId)}.json`)

  const read = (canvasId: string) =>
    Effect.tryPromise({
      try: async () => {
        let source: string
        try {
          source = await readFile(targetFor(canvasId), "utf8")
        } catch (cause) {
          if (isNodeError(cause, "ENOENT")) return inactive(canvasId)
          throw cause
        }
        const decoded = Schema.decodeUnknownSync(AgentActivityStatus)(
          JSON.parse(source) as unknown
        )
        return {
          ...decoded,
          active:
            decoded.activeUntil !== null &&
            Date.parse(decoded.activeUntil) > now().getTime()
        }
      },
      catch: (cause) => failure("read", canvasId, cause)
    })

  const write = (status: AgentActivityStatus) =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(directory, { recursive: true })
        const target = targetFor(status.canvasId)
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify(status)}\n`, { mode: 0o600 })
          await rename(temporary, target)
        } finally {
          await unlink(temporary).catch(() => undefined)
        }
        return status
      },
      catch: (cause) => failure("write", status.canvasId, cause)
    })

  const signal = (input: SignalAgentActivityInput) =>
    Effect.gen(function*() {
      if (
        !Number.isInteger(input.activeForSeconds) ||
        input.activeForSeconds < 1 ||
        input.activeForSeconds > MAX_ACTIVITY_SECONDS
      ) {
        return yield* new AgentActivityFailed({
          operation: "signal",
          canvasId: input.canvasId,
          detail: `Activity duration must be between 1 and ${MAX_ACTIVITY_SECONDS} seconds`
        })
      }
      const updatedAt = now()
      return yield* write({
        schemaVersion: 1,
        canvasId: input.canvasId,
        active: true,
        updatedAt: updatedAt.toISOString(),
        activeUntil: new Date(
          updatedAt.getTime() + input.activeForSeconds * 1_000
        ).toISOString(),
        detail: input.detail?.trim() || null
      })
    })

  return {
    read,
    signal,
    clear: (canvasId) => write(inactive(canvasId))
  }
}

const layer = (options: FileSystemAgentActivityOptions) =>
  Layer.succeed(AgentActivityStore, make(options))

export const FileSystemAgentActivity = { make, layer } as const

const isNodeError = (cause: unknown, code: string) =>
  cause instanceof Error && "code" in cause && cause.code === code

