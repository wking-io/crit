import { LocalDevelopment } from "@crit/local"
import { Console, Context, Effect, Layer } from "effect"
import { Command, Flag } from "effect/unstable/cli"

const crit = Command.make("crit-target").pipe(
  Command.withDescription("Crit local development tools")
)

const dev = Command.make(
  "dev",
  {
    dataRoot: Flag.string("data-root").pipe(
      Flag.withDescription("Directory for Crit installation and daemon state"),
      Flag.withDefault(".crit/v1")
    )
  },
  Effect.fn(function*({ dataRoot }) {
    yield* Effect.scoped(Effect.gen(function*() {
      const services = yield* Layer.buildWithScope(
        LocalDevelopment.layer({ dataRoot }),
        yield* Effect.scope
      )
      const development = Context.get(services, LocalDevelopment)
      yield* Console.log(`Crit daemon listening at ${development.descriptor.baseUrl}`)
      return yield* Effect.never
    }))
  })
).pipe(Command.withDescription("Run the project-local Crit daemon"))

export const command = crit.pipe(Command.withSubcommands([dev]))

export const main = Command.run(command, { version: "0.0.0" })
