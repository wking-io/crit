import { Effect, Stdio, Stream } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

import { CritRuntime } from "../runtime/crit-runtime.js"

const writeStdout = (value: string) =>
  Effect.gen(function*() {
    const stdio = yield* Stdio.Stdio
    yield* Stream.run(Stream.make(value), stdio.stdout())
  })

const createCommand = Command.make(
  "create",
  {
    id: Argument.string("id"),
    title: Flag.string("title"),
    json: Flag.boolean("json")
  },
  ({ id, title, json }) =>
    Effect.gen(function*() {
      const runtime = yield* CritRuntime
      const canvas = yield* runtime.createCanvas({ id, title })
      const output = json
        ? JSON.stringify({
            schemaVersion: 1,
            command: "create",
            canvas
          })
        : `Created Canvas "${canvas.title}" (${canvas.id}).`
      yield* writeStdout(`${output}\n`)
    })
).pipe(Command.withDescription("Create an empty Crit Canvas"))

export const critCommand = Command.make("crit").pipe(
  Command.withDescription("Arrange and assess live web iterations"),
  Command.withSubcommands([createCommand])
)

export const runCrit = (args: ReadonlyArray<string>) =>
  Command.runWith(critCommand, { version: "0.0.0" })(args)

