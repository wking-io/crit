import { CanvasId, CanvasTitle } from "@crit/domain"
import {
  inspectLocalDaemon,
  LocalDaemonIdentityMismatch,
  LocalDaemonDescriptor,
  LocalDaemonProtocolFailure,
  LocalDaemonStateMalformed,
  LocalDaemonStateMissing,
  LocalDaemonStateUnreadable,
  LocalDevelopment,
  type LocalDaemonInspection
} from "@crit/local"
import { ReplicaView } from "@crit/replica"
import { LocalApiUnauthorized, LocalApiVersionUnsupported } from "@crit/replica/http"
import { Console, Context, Effect, Layer, Match, Option, Redacted, Schema, type Effect as EffectType } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

class CliOperationalFailure extends Schema.TaggedError<CliOperationalFailure>()(
  "CliOperationalFailure",
  { message: Schema.String }
) {}

const dataRoot = Flag.string("data-root").pipe(
  Flag.withDescription("Directory for Crit installation and daemon state"),
  Flag.withDefault(".crit/v1")
)

const json = Flag.boolean("json")

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: string, name: string): EffectType.Effect<S["Type"], CliOperationalFailure> => Effect.try({
  try: () => Schema.decodeUnknownSync(schema)(value),
  catch: () => new CliOperationalFailure({ message: `Invalid ${name}: ${value}` })
})

const connected = <A, E>(
  root: string,
  use: (running: Extract<LocalDaemonInspection, { kind: "Running" }>) => EffectType.Effect<A, E>
) => Effect.scoped(Effect.gen(function*() {
  const inspection = yield* inspectLocalDaemon({ dataRoot: root }).pipe(
    Effect.mapError((failure) => new CliOperationalFailure({ message: formatFailure(failure) }))
  )
  return yield* Match.value(inspection).pipe(
    Match.when({ kind: "Running" }, use),
    Match.when({ kind: "Stopped" }, () => Effect.fail(
      new CliOperationalFailure({ message: "Crit daemon is stopped" })
    )),
    Match.when({ kind: "StaleDescriptor" }, ({ reason }) => Effect.fail(
      new CliOperationalFailure({ message: `Crit daemon is unavailable (${reason})` })
    )),
    Match.exhaustive
  )
}))

type DiscoveryFailure =
  | LocalDaemonStateMissing
  | LocalDaemonStateUnreadable
  | LocalDaemonStateMalformed
  | LocalDaemonIdentityMismatch
  | LocalDaemonProtocolFailure
  | LocalApiUnauthorized
  | LocalApiVersionUnsupported

const formatFailure = Match.typeTags<DiscoveryFailure, string>()({
  LocalDaemonStateMissing: () => "Crit is not initialized at this data root",
  LocalDaemonStateUnreadable: () => "Crit daemon state cannot be read",
  LocalDaemonStateMalformed: () => "Crit daemon state is malformed",
  LocalDaemonIdentityMismatch: () => "Crit daemon identity does not match local state",
  LocalDaemonProtocolFailure: () => "Crit daemon returned an invalid response",
  LocalApiUnauthorized: () => "Crit daemon authentication failed",
  LocalApiVersionUnsupported: () => "Crit daemon API version is incompatible"
})

const printView = (view: typeof ReplicaView.Type, asJson: boolean) => asJson
  ? Console.log(JSON.stringify(Schema.encodeSync(ReplicaView)(view)))
  : Console.log(`${view.projection.canvasId}  ${view.projection.title}`)

const crit = Command.make("crit-target").pipe(
  Command.withDescription("Crit local development tools")
)

const dev = Command.make(
  "dev",
  {
    dataRoot,
    browserOrigin: Flag.string("browser-origin").pipe(
      Flag.withDescription("Loopback origin hosting the Crit browser application"),
      Flag.optional
    )
  },
  Effect.fn(function*({ browserOrigin, dataRoot: root }) {
    yield* Effect.scoped(Effect.gen(function*() {
      const developmentLayer = Option.match(browserOrigin, {
        onNone: () => LocalDevelopment.layer({ dataRoot: root }),
        onSome: (origin) => LocalDevelopment.layer({ dataRoot: root, browserOrigin: origin })
      })
      const services = yield* Layer.buildWithScope(developmentLayer, yield* Effect.scope)
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

const status = Command.make("status", { dataRoot, json }, ({ dataRoot: root, json: asJson }) =>
  Effect.scoped(inspectLocalDaemon({ dataRoot: root }).pipe(
    Effect.flatMap((inspection) => Match.value(inspection).pipe(
      Match.when({ kind: "Running" }, ({ descriptor }) => asJson
          ? Console.log(JSON.stringify({ kind: "Running", descriptor: Schema.encodeSync(LocalDaemonDescriptor)(descriptor) }))
          : Console.log(`running  ${descriptor.baseUrl}`)),
      Match.when({ kind: "Stopped" }, () => Effect.fail(
        new CliOperationalFailure({ message: "Crit daemon is stopped" })
      )),
      Match.when({ kind: "StaleDescriptor" }, ({ reason }) => Effect.fail(
        new CliOperationalFailure({ message: `Crit daemon is unavailable (${reason})` })
      )),
      Match.exhaustive
    )),
    Effect.mapError((failure) => failure instanceof CliOperationalFailure
      ? failure
      : new CliOperationalFailure({ message: formatFailure(failure) }))
  ))).pipe(Command.withDescription("Inspect the project-local Crit daemon"))

const create = Command.make("create", {
  dataRoot,
  json,
  canvasId: Argument.string("canvas-id"),
  title: Flag.string("title")
}, ({ canvasId, dataRoot: root, json: asJson, title }) => Effect.gen(function*() {
  const id = yield* decode(CanvasId, canvasId, "canvas ID")
  const decodedTitle = yield* decode(CanvasTitle, title, "title")
  const view = yield* connected(root, ({ client }) => client.create({
    canvasId: id,
    title: decodedTitle
  }).pipe(Effect.mapError((failure) => Match.value(failure).pipe(
    Match.when({ _tag: "canvas-already-exists" }, ({ canvasId }) => new CliOperationalFailure({
      message: `Canvas already exists: ${canvasId}`
    })),
    Match.orElse(() => new CliOperationalFailure({ message: "Unable to create Canvas" }))
  ))))
  yield* printView(view, asJson)
})).pipe(Command.withDescription("Create a Canvas through the local daemon"))

const open = Command.make("open", {
  dataRoot,
  json,
  canvasId: Argument.string("canvas-id")
}, ({ canvasId, dataRoot: root, json: asJson }) => Effect.gen(function*() {
  const id = yield* decode(CanvasId, canvasId, "canvas ID")
  const view = yield* connected(root, ({ client }) => client.open(id).pipe(
    Effect.mapError((failure) => Match.value(failure).pipe(
      Match.when({ _tag: "canvas-not-found" }, ({ canvasId }) => new CliOperationalFailure({
        message: `Canvas not found: ${canvasId}`
      })),
      Match.orElse(() => new CliOperationalFailure({ message: "Unable to open Canvas" }))
    ))
  ))
  yield* printView(view, asJson)
})).pipe(Command.withDescription("Open a Canvas through the local daemon"))

export const command = crit.pipe(Command.withSubcommands([dev, status, create, open]))

export const main = Command.run(command, { version: "0.0.0" })
