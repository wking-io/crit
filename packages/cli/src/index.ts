import { LocalDevelopment } from "@crit/local"
import { Console, Context, Effect, Layer, Option, Redacted } from "effect"
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
    ),
    browserOrigin: Flag.string("browser-origin").pipe(
      Flag.withDescription("Loopback origin hosting the Crit browser application"),
      Flag.optional
    )
  },
  Effect.fn(function*({ browserOrigin, dataRoot }) {
    yield* Effect.scoped(Effect.gen(function*() {
      const developmentLayer = Option.match(browserOrigin, {
        onNone: () => LocalDevelopment.layer({ dataRoot }),
        onSome: (origin) => LocalDevelopment.layer({ dataRoot, browserOrigin: origin })
      })
      const services = yield* Layer.buildWithScope(
        developmentLayer,
        yield* Effect.scope
      )
      const development = Context.get(services, LocalDevelopment)
      yield* Console.log(`Crit daemon listening at ${development.descriptor.baseUrl}`)
      yield* Option.match(development.browserBootstrapUrl, {
        onNone: () => Effect.void,
        onSome: (url) => Console.log(`Open Crit in your browser: ${Redacted.value(url)}`)
      })
      return yield* Effect.never
    }))
  })
).pipe(Command.withDescription("Run the project-local Crit daemon"))

export const command = crit.pipe(Command.withSubcommands([dev]))

export const main = Command.run(command, { version: "0.0.0" })
