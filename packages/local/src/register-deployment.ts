import {
  DeploymentChannel,
  DeploymentUrl,
  IsoTimestamp,
  SourceRevision
} from "@crit/domain"
import {
  decodeDeploymentRegisteredWire,
  encodeRegisterDeploymentWire
} from "@crit/protocol"
import { Effect, Redacted, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest
} from "effect/unstable/http"

import { InstallationUrlInvalid } from "./login.js"
import {
  LocalProjectManifest,
  type ProjectManifestFailure
} from "./project-manifest.js"

export class DeploymentRegistrationUnauthenticated extends Schema.TaggedError<DeploymentRegistrationUnauthenticated>()(
  "DeploymentRegistrationUnauthenticated",
  {}
) {}

export class DeploymentRegistrationResponseRejected extends Schema.TaggedError<DeploymentRegistrationResponseRejected>()(
  "DeploymentRegistrationResponseRejected",
  { status: Schema.Int }
) {}

export class DeploymentRegistrationResponseInvalid extends Schema.TaggedError<DeploymentRegistrationResponseInvalid>()(
  "DeploymentRegistrationResponseInvalid",
  {}
) {}

export class DeploymentRegistrationRequestFailed extends Schema.TaggedError<DeploymentRegistrationRequestFailed>()(
  "DeploymentRegistrationRequestFailed",
  {}
) {}

export interface RegisterDeploymentOptions {
  readonly root: string
  readonly installationUrl: string
  readonly token: string | Redacted.Redacted<string>
  readonly url: DeploymentUrl
  readonly channel: DeploymentChannel
  readonly sourceRevision?: SourceRevision
  readonly expiresAt?: IsoTimestamp
}

export type RegisterDeploymentFailure =
  | DeploymentRegistrationUnauthenticated
  | DeploymentRegistrationResponseRejected
  | DeploymentRegistrationResponseInvalid
  | DeploymentRegistrationRequestFailed
  | InstallationUrlInvalid
  | ProjectManifestFailure

interface DeploymentDetails {
  sourceRevision?: SourceRevision
  expiresAt?: IsoTimestamp
}

const deploymentsUrl = (
  installationUrl: string
): Effect.Effect<string, InstallationUrlInvalid> => Effect.try({
  try: () => {
    const url = new URL(installationUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported installation URL protocol")
    }
    return `${url.origin}/deployments`
  },
  catch: () => new InstallationUrlInvalid({ installationUrl })
})

export const registerDeployment = (
  options: RegisterDeploymentOptions
) => Effect.gen(function*() {
  const endpoint = yield* deploymentsUrl(options.installationUrl)
  const manifest = yield* Effect.gen(function*() {
    const projectManifest = yield* LocalProjectManifest
    return yield* projectManifest.read
  }).pipe(Effect.provide(LocalProjectManifest.layer({ root: options.root })))
  const token = Redacted.isRedacted(options.token)
    ? options.token
    : Redacted.make(options.token)
  const details: DeploymentDetails = {}
  if (options.sourceRevision !== undefined) {
    details.sourceRevision = options.sourceRevision
  }
  if (options.expiresAt !== undefined) {
    details.expiresAt = options.expiresAt
  }
  const body = encodeRegisterDeploymentWire({
    kind: "register-deployment",
    schemaVersion: 1,
    applicationId: manifest.applicationId,
    channel: options.channel,
    url: options.url,
    ...details
  })
  const request = HttpClientRequest.bodyJsonUnsafe(
    HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.bearerToken(token)
    ),
    body
  )
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(request).pipe(
    Effect.mapError(() => new DeploymentRegistrationRequestFailed({}))
  )
  if (response.status === 401) {
    return yield* new DeploymentRegistrationUnauthenticated({})
  }
  if (response.status !== 200) {
    return yield* new DeploymentRegistrationResponseRejected({
      status: response.status
    })
  }
  const contents = yield* response.text.pipe(
    Effect.mapError(() => new DeploymentRegistrationResponseInvalid({}))
  )
  return yield* Effect.try({
    try: () => decodeDeploymentRegisteredWire(JSON.parse(contents)),
    catch: () => new DeploymentRegistrationResponseInvalid({})
  })
}).pipe(Effect.provide(FetchHttpClient.layer))
