import {
  CanvasId,
  CanvasTitle,
  PersonId
} from "@crit/domain"
import {
  decodeCanvasSharedWire,
  encodeShareCanvasWire,
  remoteCanvasCollectionPath
} from "@crit/protocol"
import { Effect, FileSystem, Path, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest
} from "effect/unstable/http"

import {
  InstallationOrigin,
  LocalInstallation
} from "./development.js"
import {
  LocalDaemonStateMalformed,
  LocalDaemonStateMissing,
  LocalDaemonStateUnreadable
} from "./discovery.js"
import { AccessPersonUnauthenticated } from "./login.js"
import { decodeStored, encodeStored } from "./stored-json.js"

export const SharedCanvas = Schema.TaggedStruct("sharedCanvas", {
  canvasId: CanvasId,
  installationOrigin: InstallationOrigin,
  personId: PersonId
})
export type SharedCanvas = typeof SharedCanvas.Type

export const LocalShares = Schema.Struct({
  version: Schema.Literal(1),
  canvases: Schema.Array(SharedCanvas)
})
export type LocalShares = typeof LocalShares.Type

export const CanvasShareSuccess = Schema.TaggedStruct("canvasShared", {
  canvasId: CanvasId,
  title: CanvasTitle,
  installationOrigin: InstallationOrigin,
  personId: PersonId
})
export type CanvasShareSuccess = typeof CanvasShareSuccess.Type

export class ShareRequiresLogin extends Schema.TaggedError<ShareRequiresLogin>()(
  "ShareRequiresLogin",
  {}
) {}

export class ShareRequestFailed extends Schema.TaggedError<ShareRequestFailed>()(
  "ShareRequestFailed",
  {}
) {}

export class ShareResponseRejected extends Schema.TaggedError<ShareResponseRejected>()(
  "ShareResponseRejected",
  { status: Schema.Int }
) {}

export class ShareResponseInvalid extends Schema.TaggedError<ShareResponseInvalid>()(
  "ShareResponseInvalid",
  {}
) {}

export class SharePersistenceFailure extends Schema.TaggedError<SharePersistenceFailure>()(
  "SharePersistenceFailure",
  {
    operation: Schema.Literals(["inspect", "read", "decode", "write"]),
    path: Schema.String
  }
) {}

export interface ShareCanvasOptions {
  readonly dataRoot: string
  readonly canvasId: typeof CanvasId.Type
  readonly title: typeof CanvasTitle.Type
}

const readInstallation = (dataRoot: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const installationPath = path.join(dataRoot, "installation.json")
  const unreadable = (reason: string) => new LocalDaemonStateUnreadable({
    state: "installation",
    path: installationPath,
    reason
  })
  const exists = yield* fs.exists(installationPath).pipe(
    Effect.mapError(() => unreadable("Unable to inspect installation state"))
  )
  if (!exists) {
    return yield* new LocalDaemonStateMissing({
      state: "installation",
      path: installationPath
    })
  }
  const contents = yield* fs.readFileString(installationPath).pipe(
    Effect.mapError(() => unreadable("Unable to read installation state"))
  )
  return yield* Effect.try({
    try: () => decodeStored(LocalInstallation, contents),
    catch: () => new LocalDaemonStateMalformed({
      state: "installation",
      path: installationPath,
      reason: "Stored JSON does not match the required schema"
    })
  })
})

const writeShare = (
  dataRoot: string,
  shared: SharedCanvas
) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sharesPath = path.join(dataRoot, "shares.json")
  const failure = (
    operation: "inspect" | "read" | "decode" | "write"
  ) => new SharePersistenceFailure({ operation, path: sharesPath })
  const exists = yield* fs.exists(sharesPath).pipe(
    Effect.mapError(() => failure("inspect"))
  )
  const stored = !exists
    ? LocalShares.make({ version: 1, canvases: [] })
    : yield* fs.readFileString(sharesPath).pipe(
      Effect.mapError(() => failure("read")),
      Effect.flatMap((contents) => Effect.try({
        try: () => decodeStored(LocalShares, contents),
        catch: () => failure("decode")
      }))
    )
  const matching = stored.canvases.filter(
    (candidate) => candidate.canvasId === shared.canvasId
  )
  if (
    matching.length === 1 &&
    matching[0]?.installationOrigin === shared.installationOrigin &&
    matching[0].personId === shared.personId
  ) {
    return
  }
  const updated = LocalShares.make({
    version: 1,
    canvases: [
      ...stored.canvases.filter((candidate) => candidate.canvasId !== shared.canvasId),
      shared
    ]
  })
  const temporaryPath = path.join(
    dataRoot,
    `.shares-${shared.canvasId}.tmp`
  )
  yield* Effect.scoped(Effect.gen(function*() {
    const file = yield* fs.open(temporaryPath, { flag: "wx", mode: 0o600 })
    yield* file.writeAll(new TextEncoder().encode(
      encodeStored(LocalShares, updated)
    ))
    yield* file.sync
    yield* fs.rename(temporaryPath, sharesPath)
  })).pipe(
    Effect.ensuring(fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
    Effect.mapError(() => failure("write"))
  )
  yield* fs.chmod(sharesPath, 0o600).pipe(
    Effect.mapError(() => failure("write"))
  )
})

export const shareCanvas = (
  options: ShareCanvasOptions
) => Effect.gen(function*() {
  const installation = yield* readInstallation(options.dataRoot)
  const email = installation.principal.person.email
  const installationOrigin = installation.installationOrigin
  if (email._tag !== "access" || installationOrigin === undefined) {
    return yield* new ShareRequiresLogin({})
  }

  const request = encodeShareCanvasWire({
    kind: "share-canvas",
    schemaVersion: 1,
    canvasId: options.canvasId,
    title: options.title,
    person: {
      ...installation.principal.person,
      email
    }
  })
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.bodyJsonUnsafe(
    HttpClientRequest.post(`${installationOrigin}${remoteCanvasCollectionPath}`),
    request
  )).pipe(
    Effect.mapError(() => new ShareRequestFailed({}))
  )
  if (response.status === 401) {
    return yield* new AccessPersonUnauthenticated({})
  }
  if (response.status !== 200) {
    return yield* new ShareResponseRejected({ status: response.status })
  }
  const contents = yield* response.text.pipe(
    Effect.mapError(() => new ShareResponseInvalid({}))
  )
  const receipt = yield* Effect.try({
    try: () => decodeCanvasSharedWire(JSON.parse(contents)),
    catch: () => new ShareResponseInvalid({})
  })

  const shared = SharedCanvas.make({
    canvasId: receipt.canvasId,
    installationOrigin,
    personId: installation.principal.person.personId
  })
  yield* writeShare(options.dataRoot, shared)
  return CanvasShareSuccess.make({
    canvasId: receipt.canvasId,
    title: receipt.title,
    installationOrigin,
    personId: shared.personId
  })
}).pipe(Effect.provide(FetchHttpClient.layer))
