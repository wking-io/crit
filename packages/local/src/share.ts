import {
  CanvasId,
  CanvasProjection,
  CanvasTitle,
  Id,
  ImportId,
  PersonId,
  Sha256Digest,
  ShareId,
  WorkspaceId
} from "@crit/domain"
import {
  decodeCanvasSharedWire,
  critPersonIdHeader,
  encodeShareCanvasWire,
  remoteCanvasCollectionPath,
  ShareDigestMismatch as ShareDigestMismatchWire
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
import { projectionDigest } from "./projection-digest.js"
import { decodeStored, encodeStored } from "./stored-json.js"

export const shareIdForCanvas = (canvasId: CanvasId) =>
  Id.share(`share_${canvasId}`)

export const importIdForCanvas = (canvasId: CanvasId) =>
  Id.imported(`import_${canvasId}`)

export const SharedCanvas = Schema.TaggedStruct("sharedCanvas", {
  canvasId: CanvasId,
  installationOrigin: InstallationOrigin,
  personId: PersonId,
  shareId: ShareId,
  importId: ImportId,
  projectionDigest: Sha256Digest,
  workspaceId: WorkspaceId
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
  personId: PersonId,
  shareId: ShareId,
  importId: ImportId,
  projectionDigest: Sha256Digest,
  workspaceId: WorkspaceId
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

export class ShareDigestMismatch extends Schema.TaggedError<ShareDigestMismatch>()(
  "ShareDigestMismatch",
  {
    shareId: ShareId,
    expectedDigest: Sha256Digest,
    receivedDigest: Sha256Digest
  }
) {}

export interface ShareCanvasOptions {
  readonly dataRoot: string
  readonly projection: CanvasProjection
}

export const readLocalInstallation = (dataRoot: string) => Effect.gen(function*() {
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

const sameShare = (left: SharedCanvas, right: SharedCanvas) =>
  left.canvasId === right.canvasId &&
  left.installationOrigin === right.installationOrigin &&
  left.personId === right.personId &&
  left.shareId === right.shareId &&
  left.importId === right.importId &&
  left.projectionDigest === right.projectionDigest &&
  left.workspaceId === right.workspaceId

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
  if (matching.length === 1 && matching[0] !== undefined && sameShare(matching[0], shared)) {
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

const rejectedShare = (status: number, body: string) => {
  if (status !== 409) return new ShareResponseRejected({ status })
  try {
    const mismatch = Schema.decodeUnknownSync(ShareDigestMismatchWire)(
      JSON.parse(body)
    )
    return new ShareDigestMismatch({
      shareId: mismatch.shareId,
      expectedDigest: mismatch.expectedDigest,
      receivedDigest: mismatch.receivedDigest
    })
  } catch {
    return new ShareResponseRejected({ status })
  }
}

export const readLocalShares = (dataRoot: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const sharesPath = path.join(dataRoot, "shares.json")
  const failure = (
    operation: "inspect" | "read" | "decode" | "write"
  ) => new SharePersistenceFailure({ operation, path: sharesPath })
  const exists = yield* fs.exists(sharesPath).pipe(
    Effect.mapError(() => failure("inspect"))
  )
  if (!exists) return LocalShares.make({ version: 1, canvases: [] })
  return yield* fs.readFileString(sharesPath).pipe(
    Effect.mapError(() => failure("read")),
    Effect.flatMap((contents) => Effect.try({
      try: () => decodeStored(LocalShares, contents),
      catch: () => failure("decode")
    }))
  )
})

export const shareCanvas = (
  options: ShareCanvasOptions
) => Effect.gen(function*() {
  const installation = yield* readLocalInstallation(options.dataRoot)
  const email = installation.principal.person.email
  const installationOrigin = installation.installationOrigin
  if (installationOrigin === undefined) {
    return yield* new ShareRequiresLogin({})
  }

  const shareId = shareIdForCanvas(options.projection.canvasId)
  const importId = importIdForCanvas(options.projection.canvasId)
  const digest = projectionDigest(options.projection)
  const payload = encodeShareCanvasWire({
    kind: "share-canvas",
    schemaVersion: 2,
    canvasId: options.projection.canvasId,
    title: options.projection.title,
    shareId,
    importId,
    projectionDigest: digest,
    person: {
      ...installation.principal.person,
      email
    }
  })
  const http = yield* HttpClient.HttpClient
  let request = HttpClientRequest.bodyJsonUnsafe(
    HttpClientRequest.post(`${installationOrigin}${remoteCanvasCollectionPath}`),
    payload
  )
  if (email._tag === "unspecified") {
    request = HttpClientRequest.setHeader(
      request,
      critPersonIdHeader,
      installation.principal.person.personId
    )
  }
  const response = yield* http.execute(request).pipe(
    Effect.mapError(() => new ShareRequestFailed({}))
  )
  if (response.status === 401) {
    return yield* new AccessPersonUnauthenticated({})
  }
  const contents = yield* response.text.pipe(
    Effect.mapError(() => new ShareResponseInvalid({}))
  )
  if (response.status !== 200) {
    return yield* rejectedShare(response.status, contents)
  }
  const receipt = yield* Effect.try({
    try: () => decodeCanvasSharedWire(JSON.parse(contents)),
    catch: () => new ShareResponseInvalid({})
  })

  const shared = SharedCanvas.make({
    canvasId: receipt.canvasId,
    installationOrigin,
    personId: receipt.personId,
    shareId: receipt.shareId,
    importId: receipt.importId,
    projectionDigest: receipt.projectionDigest,
    workspaceId: receipt.workspaceId
  })
  yield* writeShare(options.dataRoot, shared)
  return CanvasShareSuccess.make({
    canvasId: receipt.canvasId,
    title: receipt.title,
    installationOrigin,
    personId: shared.personId,
    shareId: receipt.shareId,
    importId: receipt.importId,
    projectionDigest: receipt.projectionDigest,
    workspaceId: receipt.workspaceId
  })
}).pipe(Effect.provide(FetchHttpClient.layer))
