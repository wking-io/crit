import { AuthorityModel } from "@crit/authority"
import { AuthSubject, Id, InstallationId, PersonPrincipal, PersonSnapshot } from "@crit/domain"
import {
  localApiToken,
  LocalDaemonInstanceNonce,
  localApiVersion
} from "@crit/replica/http"
import {
  ApplicationBindings,
  RepresentationRuntimeLive
} from "@crit/representations"
import {
  Context,
  Crypto,
  Effect,
  Encoding,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Schema
} from "effect"
import { HttpServer } from "effect/unstable/http"

import { localDaemonWithBrowser, LocalDaemon } from "./daemon.js"
import { LocalArtifactStore } from "./artifact-store.js"
import {
  LocalProjectApplicationBindings,
  type LocalProjectApplicationBindingsOptions
} from "./application-bindings.js"
import { BrowserOrigin, BrowserSession } from "./browser-session.js"
import { decodeStored, encodeStored } from "./stored-json.js"

const InstallationSecret = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)
).pipe(Schema.brand("LocalInstallationSecret"))

const LocalPort = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1024),
  Schema.isLessThanOrEqualTo(65_535)
).pipe(Schema.brand("LocalPort"))

export const LocalInstallation = Schema.Struct({
  version: Schema.Literal(1),
  installationId: InstallationId,
  principal: PersonPrincipal,
  bearerSecret: InstallationSecret,
  port: LocalPort
})
export type LocalInstallation = typeof LocalInstallation.Type

export const LocalDaemonDescriptor = Schema.Struct({
  version: Schema.Literal(1),
  instance: LocalDaemonInstanceNonce,
  baseUrl: Schema.String.check(Schema.isPattern(/^http:\/\/127\.0\.0\.1:[0-9]+$/)),
  apiVersion: Schema.Literal(localApiVersion),
  installationId: InstallationId
})
export type LocalDaemonDescriptor = typeof LocalDaemonDescriptor.Type

export class LocalDevelopmentFailure extends Schema.TaggedError<LocalDevelopmentFailure>()(
  "LocalDevelopmentFailure",
  { operation: Schema.String, path: Schema.String, reason: Schema.String }
) {}

export class LocalDaemonOwnershipFailure extends Schema.TaggedError<LocalDaemonOwnershipFailure>()(
  "LocalDaemonOwnershipFailure",
  { port: LocalPort, reason: Schema.String }
) {}

export interface LocalDevelopmentOptions {
  readonly dataRoot: string
  readonly allowedOrigins?: ReadonlySet<string>
  readonly browserOrigin?: string
  readonly application?: LocalProjectApplicationBindingsOptions
}

export interface LocalDevelopmentService {
  readonly descriptor: LocalDaemonDescriptor
  readonly installationId: InstallationId
  readonly browserBootstrapUrl: Option.Option<Redacted.Redacted<string>>
}

const AddressInUseFailure = Schema.Struct({
  _tag: Schema.Literal("ServeError"),
  cause: Schema.Struct({ code: Schema.Literal("EADDRINUSE") })
})
const DatabaseOpenFailure = Schema.Struct({
  _tag: Schema.Literal("LocalDatabaseOpenFailure"),
  path: Schema.String,
  reason: Schema.String
})
const TaggedFailure = Schema.Struct({ _tag: Schema.String })

export class LocalDevelopment extends Context.Service<
  LocalDevelopment,
  LocalDevelopmentService
>()("@crit/local/LocalDevelopment") {
  static readonly layer = (options: LocalDevelopmentOptions) => Layer.effect(
    LocalDevelopment,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const installationPath = path.join(options.dataRoot, "installation.json")
      const descriptorPath = path.join(options.dataRoot, "daemon.json")
      const databasePath = path.join(options.dataRoot, "local.sqlite")

      const fail = (operation: string, target: string, reason: string) =>
        new LocalDevelopmentFailure({ operation, path: target, reason })
      const daemonScope = yield* Effect.scope
      const applicationBindings = options.application === undefined
        ? ApplicationBindings.of({ get: () => Effect.succeed(Option.none()) })
        : yield* Layer.buildWithScope(
          LocalProjectApplicationBindings.layer(options.application),
          daemonScope
        ).pipe(
          Effect.map((context) => Context.get(context, ApplicationBindings)),
          Effect.mapError((cause) => fail(
            "bind application",
            options.application?.root ?? "application",
            Schema.is(TaggedFailure)(cause) ? cause._tag : "Application binding failed"
          ))
        )
      const readInstallation = fs.readFileString(installationPath).pipe(
        Effect.mapError((cause) => fail("read installation", installationPath, String(cause))),
        Effect.flatMap((value) => Effect.try({
          try: () => decodeStored(LocalInstallation, value),
          catch: (cause) => fail("decode installation", installationPath, String(cause))
        }))
      )

      yield* fs.makeDirectory(options.dataRoot, { recursive: true, mode: 0o700 }).pipe(
        Effect.flatMap(() => fs.chmod(options.dataRoot, 0o700)),
        Effect.mapError((cause) => fail("secure data directory", options.dataRoot, String(cause)))
      )

      const exists = yield* fs.exists(installationPath).pipe(
        Effect.mapError((cause) => fail("inspect installation", installationPath, String(cause)))
      )
      const installation = exists
        ? yield* readInstallation
        : yield* Effect.gen(function*() {
          const randomBytes = (size: number) => crypto.randomBytes(size).pipe(
            Effect.mapError((cause) => fail("generate installation identity", installationPath, String(cause)))
          )
          const idBytes = yield* randomBytes(16)
          const secretBytes = yield* randomBytes(64)
          const portBytes = yield* randomBytes(2)
          const suffix = Encoding.encodeHex(idBytes)
          const candidate = Schema.decodeUnknownSync(LocalInstallation)({
            version: 1,
            installationId: Id.installation(`installation_${suffix}`),
            principal: PersonPrincipal.make({
              subject: Schema.decodeUnknownSync(AuthSubject)(`local|installation_${suffix}`),
              person: PersonSnapshot.make({
                personId: Id.person(`person_${suffix}`),
                displayName: "Local Crit User"
              })
            }),
            bearerSecret: Encoding.encodeBase64Url(secretBytes),
            port: 49_152 + (((portBytes[0] ?? 0) << 8 | (portBytes[1] ?? 0)) % 16_384)
          })
          const temporaryPath = path.join(options.dataRoot, `.installation-${suffix}.tmp`)
          const publish = Effect.scoped(Effect.gen(function*() {
            const file = yield* fs.open(temporaryPath, { flag: "wx", mode: 0o600 })
            yield* file.writeAll(new TextEncoder().encode(encodeStored(LocalInstallation, candidate)))
            yield* file.sync
            yield* fs.link(temporaryPath, installationPath)
          })).pipe(
            Effect.ensuring(fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
            Effect.mapError((cause) => fail("create installation", installationPath, String(cause)))
          )
          return yield* publish.pipe(Effect.as(candidate), Effect.catch(() => readInstallation))
        })

      yield* fs.chmod(installationPath, 0o600).pipe(
        Effect.mapError((cause) => fail("secure installation", installationPath, String(cause)))
      )

      const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
        Encoding.encodeHex(yield* crypto.randomBytes(16).pipe(
          Effect.mapError((cause) => fail("generate daemon instance", descriptorPath, String(cause)))
        ))
      )
      const invocation = AuthorityModel.personInvocation({ principal: installation.principal })
      const browserOrigin = yield* options.browserOrigin === undefined
        ? Effect.succeed(Option.none())
        : Effect.try({
          try: () => Option.some(Schema.decodeUnknownSync(BrowserOrigin)(options.browserOrigin)),
          catch: (cause) => fail("validate browser origin", "browserOrigin", String(cause))
        })
      const browser = yield* Option.match(browserOrigin, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (origin) => Layer.buildWithScope(BrowserSession.layer({
          baseUrl: `http://127.0.0.1:${installation.port}`,
          instance,
          browserOrigin: origin,
          invocation
        }), daemonScope).pipe(
          Effect.map((context) => Option.some(Context.get(context, BrowserSession)))
        )
      })
      const daemonOptions = {
        databasePath,
        token: localApiToken(installation.bearerSecret),
        allowedOrigins: options.allowedOrigins ?? new Set(),
        invocation,
        port: installation.port,
        instance,
        installationId: installation.installationId
      }
      const daemonLayer = Option.match(browser, {
        onNone: () => LocalDaemon.layer(daemonOptions),
        onSome: (session) => localDaemonWithBrowser(daemonOptions, session)
      })
      const representationRuntime = RepresentationRuntimeLive.pipe(
        Layer.provide(LocalArtifactStore.layer({ directory: options.dataRoot })),
        Layer.provide(Layer.succeed(ApplicationBindings, applicationBindings))
      )
      const daemonContext = yield* Layer.buildWithScope(
        daemonLayer.pipe(Layer.provide(representationRuntime)),
        daemonScope
      ).pipe(
        Effect.mapError((cause) => {
          if (Schema.is(AddressInUseFailure)(cause)) {
            return new LocalDaemonOwnershipFailure({
              port: installation.port,
              reason: "The configured port is already in use"
            })
          }
          if (Schema.is(DatabaseOpenFailure)(cause)) {
            return fail("open local database", cause.path, cause.reason)
          }
          const tag = Schema.is(TaggedFailure)(cause) ? cause._tag : "UnknownFailure"
          return fail("start daemon", descriptorPath, `Daemon startup failed (${tag})`)
        })
      )
      const server = Context.get(daemonContext, HttpServer.HttpServer)
      if (server.address._tag !== "TcpAddress") {
        return yield* Effect.fail(fail("bind daemon", descriptorPath, "Expected a TCP address"))
      }
      const descriptor = Schema.decodeUnknownSync(LocalDaemonDescriptor)({
        version: 1,
        instance,
        baseUrl: `http://127.0.0.1:${server.address.port}`,
        apiVersion: localApiVersion,
        installationId: installation.installationId
      })
      const temporaryDescriptor = path.join(options.dataRoot, `.daemon-${instance}.tmp`)
      yield* fs.writeFileString(
        temporaryDescriptor,
        encodeStored(LocalDaemonDescriptor, descriptor),
        { flag: "wx", mode: 0o600 }
      ).pipe(
        Effect.flatMap(() => fs.rename(temporaryDescriptor, descriptorPath)),
        Effect.ensuring(fs.remove(temporaryDescriptor, { force: true }).pipe(Effect.ignore)),
        Effect.mapError((cause) => fail("publish daemon descriptor", descriptorPath, String(cause)))
      )
      yield* Effect.addFinalizer(() => fs.readFileString(descriptorPath).pipe(
        Effect.flatMap((value) => Effect.try(() => decodeStored(LocalDaemonDescriptor, value))),
        Effect.flatMap((current) => current.instance === instance
          ? fs.remove(descriptorPath, { force: true })
          : Effect.void),
        Effect.ignore
      ))
      yield* Effect.logInfo("Local daemon started").pipe(
        Effect.annotateLogs({ "crit.event": "daemon-started" })
      )
      yield* Effect.addFinalizer(() => Effect.logInfo("Local daemon stopped").pipe(
        Effect.annotateLogs({ "crit.event": "daemon-stopped" })
      ))
      return LocalDevelopment.of({
        descriptor,
        installationId: installation.installationId,
        browserBootstrapUrl: Option.map(browser, (session) => session.bootstrapUrl)
      })
    })
  )
}
