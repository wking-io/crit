import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"

import { Effect, Schedule, Schema } from "effect"

export class LocalDaemonOwnershipFailure extends Schema.TaggedError<LocalDaemonOwnershipFailure>()(
  "LocalDaemonOwnershipFailure",
  { path: Schema.String, reason: Schema.Literals(["busy", "unavailable"]), message: Schema.String }
) {}

export const acquireDaemonOwnership = (dataRoot: string) => Effect.acquireRelease(
  Effect.try({
    try: () => {
      const database = new DatabaseSync(join(dataRoot, "daemon-lock.sqlite"))
      try {
        database.exec("BEGIN EXCLUSIVE")
        return database
      } catch (cause) {
        database.close()
        throw cause
      }
    },
    catch: (cause) => {
      const busy = cause instanceof Error && "errcode" in cause && cause.errcode === 5
      return new LocalDaemonOwnershipFailure({
        path: dataRoot,
        reason: busy ? "busy" : "unavailable",
        message: busy
          ? "A Crit daemon is already running for this project"
          : "Unable to acquire the project daemon lock"
      })
    }
  }).pipe(Effect.retry({
    schedule: Schedule.spaced("100 millis"),
    times: 10,
    while: (failure) => failure.reason === "busy"
  })),
  (database) => Effect.sync(() => database.close())
)
