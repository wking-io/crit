import {
  AgentSnapshot,
  ApplicationRouteRepresentation,
  ArtifactId,
  ArtifactRepresentation,
  AuthoredText,
  CanvasId,
  CanvasTitle,
  DeploymentChannel,
  DeploymentUrl,
  Id,
  IsoTimestamp,
  ReportedRuntime,
  RootedRoute,
  Sha256Digest,
  SourceRevision,
  WebUrlRepresentation
} from "@crit/domain"
import {
  AccessPersonAlreadyBound,
  AccessPersonBinding,
  AccessPersonRequestFailed,
  AccessPersonResponseInvalid,
  AccessPersonResponseRejected,
  AccessPersonUnauthenticated,
  CanvasShareSuccess,
  InstallationUrlInvalid,
  AGENT_SESSION_ENV,
  inspectLocalDaemon,
  LocalDaemonIdentityMismatch,
  LocalDaemonDescriptor,
  LocalDaemonProtocolFailure,
  LocalDaemonStateMalformed,
  LocalDaemonStateMissing,
  LocalDaemonStateUnreadable,
  LocalDevelopment,
  LocalProjectManifest,
  loginToInstallation,
  ProjectManifestInitialization,
  registerDeployment,
  shareCanvas,
  SharePersistenceFailure,
  ShareRequestFailed,
  ShareRequiresLogin,
  ShareResponseInvalid,
  ShareResponseRejected,
  type RegisterDeploymentFailure,
  type ProjectManifestFailure,
  type LocalDaemonInspection
} from "@crit/local"
import { ReplicaModel, ReplicaView } from "@crit/replica"
import { LocalApiUnauthorized, LocalApiVersionUnsupported } from "@crit/replica/http"
import { ApplicationBaseUrl } from "@crit/representations"
import { Console, Context, Crypto, Effect, FileSystem, Layer, Match, Option, Path, Redacted, Result, Schema, type Effect as EffectType } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"

import { frameCommand, frameSourceLabel, resolveFrameGeometry } from "./add-frame.js"
import { HOST_ORIGIN, resolveHostRoot, startHostApp } from "./host-app.js"
import { CanvasLayout, canvasLayout, formatCanvasLayout } from "./layout.js"
import { PROJECT_SKILL_RELATIVE_PATH, projectSkillSource } from "./project-skill.js"
import {
  REGISTER_DEPLOYMENT_SKILL_RELATIVE_PATH,
  registerDeploymentSkillSource
} from "./register-deployment-skill.js"

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

const requiredFlag = <A>(value: Option.Option<A>, message: string): EffectType.Effect<A, CliOperationalFailure> =>
  Option.match(value, {
    onNone: () => Effect.fail(new CliOperationalFailure({ message })),
    onSome: Effect.succeed
  })

const unusedFlag = (value: Option.Option<string>, message: string): EffectType.Effect<void, CliOperationalFailure> =>
  Option.match(value, {
    onNone: () => Effect.void,
    onSome: () => Effect.fail(new CliOperationalFailure({ message }))
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

const formatProjectManifestFailure = Match.typeTags<ProjectManifestFailure, string>()({
  ProjectManifestInvalid: ({ path, reason }) => `Crit project manifest is invalid: ${path} (${reason})`,
  ProjectManifestIoFailure: ({ operation, path, reason }) =>
    `Unable to ${operation} Crit project manifest at ${path} (${reason})`
})

const crit = Command.make("crit").pipe(
  Command.withDescription("Crit local development tools")
)

const init = Command.make(
  "init",
  {
    root: Flag.directory("root", { mustExist: true }).pipe(Flag.withDefault(".")),
    json
  },
  ({ json: asJson, root }) => Effect.gen(function*() {
    const result = yield* Effect.gen(function*() {
      const projectManifest = yield* LocalProjectManifest
      return yield* projectManifest.initialize
    }).pipe(
      Effect.provide(LocalProjectManifest.layer({ root })),
      Effect.mapError((failure) => new CliOperationalFailure({
        message: formatProjectManifestFailure(failure)
      }))
    )
    const pathService = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const skillPath = pathService.join(root, PROJECT_SKILL_RELATIVE_PATH)
    const skills = [
      {
        relativePath: PROJECT_SKILL_RELATIVE_PATH,
        source: projectSkillSource
      },
      {
        relativePath: REGISTER_DEPLOYMENT_SKILL_RELATIVE_PATH,
        source: registerDeploymentSkillSource
      }
    ]
    for (const skill of skills) {
      const target = pathService.join(root, skill.relativePath)
      const skillExists = yield* fs.exists(target)
      if (skillExists) continue
      yield* fs.makeDirectory(pathService.dirname(target), { recursive: true }).pipe(
        Effect.mapError((cause) => new CliOperationalFailure({
          message: `Unable to create Crit skill directory (${String(cause)})`
        }))
      )
      yield* fs.writeFileString(target, skill.source).pipe(
        Effect.mapError((cause) => new CliOperationalFailure({
          message: `Unable to write Crit skill (${String(cause)})`
        }))
      )
    }
    if (asJson) {
      return yield* Console.log(JSON.stringify(
        Schema.encodeSync(ProjectManifestInitialization)(result)
      ))
    }
    yield* Console.log(`${result._tag}  ${result.path}`)
    yield* Console.log(`Application  ${result.manifest.applicationId}`)
    yield* Console.log(`Skill  ${skillPath}`)
    yield* Console.log(
      `Skill  ${pathService.join(root, REGISTER_DEPLOYMENT_SKILL_RELATIVE_PATH)}`
    )
  })
).pipe(Command.withDescription("Initialize Crit project identity and local agent skill"))

const dev = Command.make(
  "dev",
  {
    dataRoot,
    root: Flag.directory("root", { mustExist: true }).pipe(
      Flag.withDescription("Project root containing the Crit manifest"),
      Flag.withDefault(".")
    ),
    applicationOrigin: Flag.string("application-origin").pipe(
      Flag.withDescription("Canonical base URL of the project application"),
      Flag.optional
    ),
    browserOrigin: Flag.string("browser-origin").pipe(
      Flag.withDescription("Loopback origin hosting the Crit browser application"),
      Flag.optional
    ),
    noHost: Flag.boolean("no-host").pipe(
      Flag.withDescription("Do not start the Crit browser application")
    )
  },
  Effect.fn(function*({ applicationOrigin, browserOrigin, dataRoot: root, noHost, root: projectRoot }) {
    const application = yield* Option.match(applicationOrigin, {
      onNone: () => Effect.succeed(undefined),
      onSome: (origin) => decode(ApplicationBaseUrl, origin, "application origin").pipe(
        Effect.map((baseUrl) => ({ root: projectRoot, baseUrl }))
      )
    })
    yield* Effect.scoped(Effect.gen(function*() {
      const applicationOptions = application === undefined ? {} : { application }
      const resolvedBrowserOrigin = yield* Option.match(browserOrigin, {
        onSome: (origin) => Effect.succeed(Option.some(origin)),
        onNone: () => noHost
          ? Effect.succeed(Option.none<string>())
          : Effect.gen(function*() {
            const hostRoot = resolveHostRoot()
            if (hostRoot === undefined) {
              return yield* Effect.fail(new CliOperationalFailure({
                message: "Unable to find the Crit browser application"
              }))
            }
            yield* startHostApp(hostRoot).pipe(
              Effect.mapError((failure) => new CliOperationalFailure({ message: failure.message }))
            )
            return Option.some(HOST_ORIGIN)
          })
      })
      const developmentLayer = Option.match(resolvedBrowserOrigin, {
        onNone: () => LocalDevelopment.layer({ dataRoot: root, ...applicationOptions }),
        onSome: (origin) => LocalDevelopment.layer({
          dataRoot: root,
          ...applicationOptions,
          browserOrigin: origin
        })
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
).pipe(Command.withDescription("Run the project-local Crit daemon and browser application"))

type LoginFailure =
  | AccessPersonAlreadyBound
  | AccessPersonRequestFailed
  | AccessPersonResponseInvalid
  | AccessPersonResponseRejected
  | AccessPersonUnauthenticated
  | InstallationUrlInvalid
  | LocalDaemonStateMalformed
  | LocalDaemonStateMissing
  | LocalDaemonStateUnreadable

const formatLoginFailure = Match.typeTags<LoginFailure, string>()({
  AccessPersonAlreadyBound: ({ existingAddress }) =>
    `Crit Person is already bound to ${existingAddress}`,
  AccessPersonRequestFailed: () => "Unable to reach the Crit installation",
  AccessPersonResponseInvalid: () =>
    "Installation returned an invalid Access-authenticated Person",
  AccessPersonResponseRejected: ({ status }) =>
    `Installation returned an unexpected response (HTTP ${status})`,
  AccessPersonUnauthenticated: () =>
    "Installation did not return an Access-authenticated Person",
  InstallationUrlInvalid: ({ installationUrl }) =>
    `Invalid installation URL: ${installationUrl}`,
  LocalDaemonStateMalformed: () => "Crit installation state is malformed",
  LocalDaemonStateMissing: () => "Crit is not initialized at this data root",
  LocalDaemonStateUnreadable: () => "Crit installation state cannot be read"
})

const login = Command.make("login", {
  dataRoot,
  json,
  installationUrl: Argument.string("installation-url")
}, ({ dataRoot: root, installationUrl, json: asJson }) =>
  loginToInstallation({ dataRoot: root, installationUrl }).pipe(
    Effect.flatMap((result) => asJson
      ? Console.log(JSON.stringify(Schema.encodeSync(AccessPersonBinding)(result)))
      : Console.log(`Person  ${result.personId}`).pipe(
        Effect.andThen(Console.log(`Access  ${result.email.address}`))
      )),
    Effect.mapError((failure) => new CliOperationalFailure({
      message: formatLoginFailure(failure)
    }))
  )).pipe(Command.withDescription(
  "Bind the local Person through an installation such as https://crit.acme.internal"
))

type ShareFailure =
  | AccessPersonUnauthenticated
  | LocalDaemonStateMalformed
  | LocalDaemonStateMissing
  | LocalDaemonStateUnreadable
  | SharePersistenceFailure
  | ShareRequestFailed
  | ShareRequiresLogin
  | ShareResponseInvalid
  | ShareResponseRejected

const formatShareFailure = Match.typeTags<ShareFailure, string>()({
  AccessPersonUnauthenticated: () => "Installation did not accept the share",
  LocalDaemonStateMalformed: () => "Run crit login",
  LocalDaemonStateMissing: () => "Run crit login",
  LocalDaemonStateUnreadable: () => "Run crit login",
  SharePersistenceFailure: () => "Unable to record the shared Canvas",
  ShareRequestFailed: () => "Unable to reach the Crit installation",
  ShareRequiresLogin: () => "Run crit login",
  ShareResponseInvalid: () => "Installation returned an invalid share receipt",
  ShareResponseRejected: ({ status }) =>
    `Installation returned an unexpected share response (HTTP ${status})`
})

interface DeploymentDetails {
  sourceRevision?: SourceRevision
  expiresAt?: IsoTimestamp
}

const formatRegisterDeploymentFailure = Match.typeTags<
  RegisterDeploymentFailure,
  string
>()({
  DeploymentRegistrationRequestFailed: () =>
    "Unable to reach the Crit installation",
  DeploymentRegistrationResponseInvalid: () =>
    "Installation returned an invalid deployment registration response",
  DeploymentRegistrationResponseRejected: ({ status }) =>
    `Installation rejected deployment registration (HTTP ${status})`,
  DeploymentRegistrationUnauthenticated: () =>
    "Installation rejected deployment credentials",
  InstallationUrlInvalid: ({ installationUrl }) =>
    `Invalid installation URL: ${installationUrl}`,
  ProjectManifestInvalid: ({ path, reason }) =>
    `Crit project manifest is invalid: ${path} (${reason})`,
  ProjectManifestIoFailure: ({ operation, path, reason }) =>
    `Unable to ${operation} Crit project manifest at ${path} (${reason})`
})

const registerDeploymentCommand = Command.make("register-deployment", {
  url: Flag.string("url").pipe(
    Flag.withDescription("Canonical deployed application origin")
  ),
  channel: Flag.string("channel").pipe(
    Flag.withDescription("Deployment channel"),
    Flag.withDefault("review")
  ),
  revision: Flag.string("revision").pipe(
    Flag.withDescription("Source revision"),
    Flag.optional
  ),
  expiresAt: Flag.string("expires-at").pipe(
    Flag.withDescription("Deployment expiry as a UTC ISO timestamp"),
    Flag.optional
  ),
  installationUrl: Flag.string("installation-url").pipe(
    Flag.withDescription("Crit installation URL"),
    Flag.optional
  ),
  root: Flag.directory("root", { mustExist: true }).pipe(
    Flag.withDescription("Project root containing the Crit manifest"),
    Flag.withDefault(".")
  ),
  json
}, ({
  channel,
  expiresAt,
  installationUrl,
  json: asJson,
  revision,
  root,
  url
}) => Effect.gen(function*() {
  const deployToken = process.env.CRIT_DEPLOY_TOKEN
  if (deployToken === undefined || deployToken.trim().length === 0) {
    return yield* new CliOperationalFailure({
      message: "CRIT_DEPLOY_TOKEN is required"
    })
  }
  const resolvedInstallationUrl = Option.getOrUndefined(installationUrl)
    ?? process.env.CRIT_INSTALLATION_URL
  if (
    resolvedInstallationUrl === undefined
    || resolvedInstallationUrl.length === 0
  ) {
    return yield* new CliOperationalFailure({
      message: "Provide --installation-url or CRIT_INSTALLATION_URL"
    })
  }
  const decodedUrl = yield* decode(DeploymentUrl, url, "deployment URL")
  const decodedChannel = yield* decode(
    DeploymentChannel,
    channel,
    "deployment channel"
  )
  const decodedRevision = yield* Option.match(revision, {
    onNone: () => Effect.succeed(undefined),
    onSome: (value) => decode(SourceRevision, value, "source revision")
  })
  const decodedExpiresAt = yield* Option.match(expiresAt, {
    onNone: () => Effect.succeed(undefined),
    onSome: (value) => decode(IsoTimestamp, value, "expiry timestamp")
  })
  const details: DeploymentDetails = {}
  if (decodedRevision !== undefined) {
    details.sourceRevision = decodedRevision
  }
  if (decodedExpiresAt !== undefined) {
    details.expiresAt = decodedExpiresAt
  }
  const receipt = yield* registerDeployment({
    root,
    installationUrl: resolvedInstallationUrl,
    token: Redacted.make(deployToken),
    url: decodedUrl,
    channel: decodedChannel,
    ...details
  }).pipe(Effect.mapError((failure) => new CliOperationalFailure({
    message: formatRegisterDeploymentFailure(failure)
  })))
  if (asJson) {
    return yield* Console.log(JSON.stringify(receipt))
  }
  yield* Console.log(`Deployment  ${receipt.deploymentId}`)
  yield* Console.log(`Application  ${receipt.applicationId}`)
  yield* Console.log(`Channel  ${receipt.channel}`)
  yield* Console.log(`Origin  ${receipt.url}`)
})).pipe(Command.withDescription(
  "Register a deployed application origin with a Crit installation"
))

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

const share = Command.make("share", {
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
  )).pipe(
    Effect.mapError((failure) => failure.message === "Crit is not initialized at this data root"
      ? new CliOperationalFailure({ message: "Run crit login" })
      : failure)
  )
  const result = yield* shareCanvas({
    dataRoot: root,
    canvasId: id,
    title: view.projection.title
  }).pipe(
    Effect.mapError((failure) => new CliOperationalFailure({
      message: formatShareFailure(failure)
    }))
  )
  if (asJson) {
    return yield* Console.log(JSON.stringify(
      Schema.encodeSync(CanvasShareSuccess)(result)
    ))
  }
  yield* Console.log(`Canvas  ${result.canvasId}`)
  yield* Console.log(`Installation  ${result.installationOrigin}`)
})).pipe(Command.withDescription("Share a local Canvas with the Crit installation"))

const readProjectManifest = (projectRoot: string) =>
  Effect.gen(function*() {
    const projectManifest = yield* LocalProjectManifest
    return yield* projectManifest.read
  }).pipe(
    Effect.provide(LocalProjectManifest.layer({ root: projectRoot })),
    Effect.mapError((failure) => new CliOperationalFailure({
      message: formatProjectManifestFailure(failure)
    }))
  )

const addFrame = Command.make("add-frame", {
  dataRoot,
  json,
  canvasId: Argument.string("canvas-id"),
  type: Flag.choice("type", ["application-route", "web-url", "artifact"]).pipe(
    Flag.withDescription("Frame representation type")
  ),
  route: Flag.string("route").pipe(
    Flag.withDescription("Rooted application route"),
    Flag.optional
  ),
  url: Flag.string("url").pipe(
    Flag.withDescription("Public HTTP URL"),
    Flag.optional
  ),
  artifactId: Flag.string("artifact-id").pipe(
    Flag.withDescription("Captured artifact id"),
    Flag.optional
  ),
  digest: Flag.string("digest").pipe(
    Flag.withDescription("Artifact sha256 digest"),
    Flag.optional
  ),
  title: Flag.string("title").pipe(
    Flag.withDescription("Frame title")
  ),
  x: Flag.float("x").pipe(
    Flag.withDescription("Frame x position")
  ),
  y: Flag.float("y").pipe(
    Flag.withDescription("Frame y position")
  ),
  width: Flag.float("width").pipe(Flag.optional),
  height: Flag.float("height").pipe(Flag.optional),
  root: Flag.directory("root", { mustExist: true }).pipe(Flag.withDefault("."))
}, ({
  artifactId,
  canvasId,
  dataRoot: root,
  digest,
  height,
  json: asJson,
  route,
  root: projectRoot,
  title,
  type,
  url,
  width,
  x,
  y
}) => Effect.gen(function*() {
  const id = yield* decode(CanvasId, canvasId, "canvas ID")
  const representation = yield* Match.value(type).pipe(
    Match.when("application-route", () => Effect.gen(function*() {
      yield* unusedFlag(url, "--url is not used with --type application-route")
      yield* unusedFlag(artifactId, "--artifact-id is not used with --type application-route")
      yield* unusedFlag(digest, "--digest is not used with --type application-route")
      const routeValue = yield* requiredFlag(route, "Missing --route for --type application-route")
      const decodedRoute = yield* decode(RootedRoute, routeValue, "route")
      const manifest = yield* readProjectManifest(projectRoot)
      return ApplicationRouteRepresentation.make({
        applicationId: manifest.applicationId,
        route: decodedRoute
      })
    })),
    Match.when("web-url", () => Effect.gen(function*() {
      yield* unusedFlag(route, "--route is not used with --type web-url")
      yield* unusedFlag(artifactId, "--artifact-id is not used with --type web-url")
      yield* unusedFlag(digest, "--digest is not used with --type web-url")
      const urlValue = yield* requiredFlag(url, "Missing --url for --type web-url")
      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(WebUrlRepresentation)({ _tag: "web-url", url: urlValue }),
        catch: () => new CliOperationalFailure({ message: `Invalid url: ${urlValue}` })
      })
    })),
    Match.when("artifact", () => Effect.gen(function*() {
      yield* unusedFlag(route, "--route is not used with --type artifact")
      yield* unusedFlag(url, "--url is not used with --type artifact")
      const artifactValue = yield* requiredFlag(artifactId, "Missing --artifact-id for --type artifact")
      const digestValue = yield* requiredFlag(digest, "Missing --digest for --type artifact")
      const decodedId = yield* decode(ArtifactId, artifactValue, "artifact ID")
      const decodedDigest = yield* decode(Sha256Digest, digestValue, "digest")
      return ArtifactRepresentation.make({
        artifactId: decodedId,
        digest: decodedDigest
      })
    })),
    Match.exhaustive
  )
  const resolvedTitle = yield* decode(AuthoredText, title, "title")
  const geometry = yield* Result.match(resolveFrameGeometry({ x, y, width, height }), {
    onFailure: (message) => Effect.fail(new CliOperationalFailure({ message })),
    onSuccess: Effect.succeed
  })
  const crypto = yield* Crypto.Crypto
  const frameId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => Id.frame(`frame_${uuid.replaceAll("-", "")}`)),
    Effect.mapError((cause) => new CliOperationalFailure({ message: cause.message }))
  )
  const added = yield* connected(root, ({ client }) => Effect.gen(function*() {
    yield* client.open(id).pipe(
      Effect.mapError((failure) => Match.value(failure).pipe(
        Match.when({ _tag: "canvas-not-found" }, ({ canvasId }) => new CliOperationalFailure({
          message: `Canvas not found: ${canvasId}`
        })),
        Match.orElse(() => new CliOperationalFailure({ message: "Unable to add Frame" }))
      ))
    )
    const command = frameCommand({
      frameId,
      title: resolvedTitle,
      representation,
      geometry
    })
    const changed = yield* client.change(ReplicaModel.change({
      canvasId: id,
      commands: [command]
    })).pipe(
      Effect.mapError((failure) => Match.value(failure).pipe(
        Match.when({ _tag: "canvas-not-found" }, ({ canvasId }) => new CliOperationalFailure({
          message: `Canvas not found: ${canvasId}`
        })),
        Match.when({ _tag: "change-rejected" }, () => new CliOperationalFailure({
          message: "Unable to add Frame"
        })),
        Match.orElse(() => new CliOperationalFailure({ message: "Unable to add Frame" }))
      ))
    )
    return { frameId, view: changed.view }
  }))
  if (asJson) {
    return yield* Console.log(JSON.stringify(Schema.encodeSync(ReplicaView)(added.view)))
  }
  yield* Console.log(`${added.frameId}  ${frameSourceLabel(representation)}`)
})).pipe(Command.withDescription("Add a Frame to a Canvas through the local daemon"))

const layout = Command.make("layout", {
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
      Match.orElse(() => new CliOperationalFailure({ message: "Unable to read Canvas layout" }))
    ))
  ))
  const current = canvasLayout(view.projection)
  if (asJson) {
    return yield* Console.log(JSON.stringify(Schema.encodeSync(CanvasLayout)(current)))
  }
  yield* Console.log(formatCanvasLayout(current))
})).pipe(Command.withDescription("Print Canvas Frame geometry"))

const runtimeFromFlags = (flags: {
  readonly harness: Option.Option<string>
  readonly harnessVersion: Option.Option<string>
  readonly model: Option.Option<string>
  readonly modelProvider: Option.Option<string>
  readonly modelVersion: Option.Option<string>
  readonly session: Option.Option<string>
  readonly task: Option.Option<string>
}) => Effect.gen(function*() {
  const hasDetail = Option.isSome(flags.harnessVersion)
    || Option.isSome(flags.model)
    || Option.isSome(flags.modelProvider)
    || Option.isSome(flags.modelVersion)
    || Option.isSome(flags.session)
    || Option.isSome(flags.task)
  return yield* Option.match(flags.harness, {
    onNone: () => hasDetail
      ? Effect.fail(new CliOperationalFailure({
        message: "--harness is required when reporting runtime details"
      }))
      : Effect.succeed(undefined),
    onSome: (harnessName) => Effect.try({
      try: () => {
        const harness = Option.isSome(flags.harnessVersion)
          ? { name: harnessName, version: flags.harnessVersion.value }
          : { name: harnessName }
        const model = Option.isSome(flags.model)
          ? Option.isSome(flags.modelProvider) && Option.isSome(flags.modelVersion)
            ? {
              name: flags.model.value,
              provider: flags.modelProvider.value,
              version: flags.modelVersion.value
            }
            : Option.isSome(flags.modelProvider)
              ? { name: flags.model.value, provider: flags.modelProvider.value }
              : Option.isSome(flags.modelVersion)
                ? { name: flags.model.value, version: flags.modelVersion.value }
                : { name: flags.model.value }
          : undefined
        const sessionId = Option.getOrUndefined(flags.session)
        const taskId = Option.getOrUndefined(flags.task)
        if (model !== undefined && sessionId !== undefined && taskId !== undefined) {
          return ReportedRuntime.make({
            source: "client-reported", harness, model, sessionId, taskId
          })
        }
        if (model !== undefined && sessionId !== undefined) {
          return ReportedRuntime.make({ source: "client-reported", harness, model, sessionId })
        }
        if (model !== undefined && taskId !== undefined) {
          return ReportedRuntime.make({ source: "client-reported", harness, model, taskId })
        }
        if (sessionId !== undefined && taskId !== undefined) {
          return ReportedRuntime.make({ source: "client-reported", harness, sessionId, taskId })
        }
        if (model !== undefined) {
          return ReportedRuntime.make({ source: "client-reported", harness, model })
        }
        if (sessionId !== undefined) {
          return ReportedRuntime.make({ source: "client-reported", harness, sessionId })
        }
        if (taskId !== undefined) {
          return ReportedRuntime.make({ source: "client-reported", harness, taskId })
        }
        return ReportedRuntime.make({ source: "client-reported", harness })
      },
      catch: () => new CliOperationalFailure({ message: "Invalid reported runtime" })
    })
  })
})

const agentBegin = Command.make("begin", {
  dataRoot,
  json,
  name: Flag.string("name").pipe(Flag.withDescription("Agent display name")),
  harness: Flag.string("harness").pipe(
    Flag.withDescription("Reported harness name"),
    Flag.optional
  ),
  harnessVersion: Flag.string("harness-version").pipe(
    Flag.withDescription("Reported harness version"),
    Flag.optional
  ),
  model: Flag.string("model").pipe(
    Flag.withDescription("Reported model name"),
    Flag.optional
  ),
  modelProvider: Flag.string("model-provider").pipe(
    Flag.withDescription("Reported model provider"),
    Flag.optional
  ),
  modelVersion: Flag.string("model-version").pipe(
    Flag.withDescription("Reported model version"),
    Flag.optional
  ),
  session: Flag.string("session").pipe(
    Flag.withDescription("External session reference"),
    Flag.optional
  ),
  task: Flag.string("task").pipe(
    Flag.withDescription("External task reference"),
    Flag.optional
  )
}, ({
  dataRoot: root,
  harness,
  harnessVersion,
  json: asJson,
  model,
  modelProvider,
  modelVersion,
  name,
  session,
  task
}) => Effect.gen(function*() {
  const displayName = yield* decode(AgentSnapshot.fields.displayName, name, "name")
  const reportedRuntime = yield* runtimeFromFlags({
    harness,
    harnessVersion,
    model,
    modelProvider,
    modelVersion,
    session,
    task
  })
  const declaration = reportedRuntime === undefined
    ? { displayName }
    : { displayName, reportedRuntime }
  const grant = yield* connected(root, ({ client }) => client.agentBegin(declaration).pipe(Effect.mapError((failure) => Match.value(failure).pipe(
    Match.when({ _tag: "AgentSessionRejected", reason: "session-limit" }, () =>
      new CliOperationalFailure({ message: "Crit agent session limit reached" })),
    Match.when({ _tag: "AgentSessionRejected" }, () =>
      new CliOperationalFailure({ message: "Crit agent session must be started by the local person" })),
    Match.orElse(() => new CliOperationalFailure({ message: "Unable to begin an agent session" }))
  ))))
  if (asJson) {
    return yield* Console.log(JSON.stringify({
      token: Redacted.value(grant.token),
      agent: Schema.encodeSync(AgentSnapshot)(grant.agent),
      executionId: grant.executionId
    }))
  }
  yield* Console.log(`export ${AGENT_SESSION_ENV}=${Redacted.value(grant.token)}`)
})).pipe(Command.withDescription("Begin a daemon-minted agent session"))

const agent = Command.make("agent").pipe(
  Command.withDescription("Agent session tools"),
  Command.withSubcommands([agentBegin])
)

export const command = crit.pipe(Command.withSubcommands([
  init,
  dev,
  login,
  registerDeploymentCommand,
  status,
  create,
  open,
  share,
  addFrame,
  layout,
  agent
]))

export const main = Command.run(command, { version: "0.0.0" })
