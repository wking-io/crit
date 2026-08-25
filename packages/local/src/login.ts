import {
  AccessPersonEmail,
  EmailAddress,
  PersonId,
  PersonPrincipal,
  PersonSnapshot
} from "@crit/domain"
import {
  decodeAccessAuthenticatedPersonWire
} from "@crit/protocol"
import { Effect, FileSystem, Path, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest
} from "effect/unstable/http"

import { LocalInstallation } from "./development.js"
import {
  LocalDaemonStateMalformed,
  LocalDaemonStateMissing,
  LocalDaemonStateUnreadable
} from "./discovery.js"
import { decodeStored, encodeStored } from "./stored-json.js"

export const AccessPersonBinding = Schema.TaggedStruct("access-person-bound", {
  personId: PersonId,
  email: AccessPersonEmail
})
export type AccessPersonBinding = typeof AccessPersonBinding.Type

export class AccessPersonAlreadyBound extends Schema.TaggedError<AccessPersonAlreadyBound>()(
  "AccessPersonAlreadyBound",
  { existingAddress: EmailAddress, requestedAddress: EmailAddress }
) {}

export class InstallationUrlInvalid extends Schema.TaggedError<InstallationUrlInvalid>()(
  "InstallationUrlInvalid",
  { installationUrl: Schema.String }
) {}

export class AccessPersonUnauthenticated extends Schema.TaggedError<AccessPersonUnauthenticated>()(
  "AccessPersonUnauthenticated",
  {}
) {}

export class AccessPersonResponseRejected extends Schema.TaggedError<AccessPersonResponseRejected>()(
  "AccessPersonResponseRejected",
  { status: Schema.Int }
) {}

export class AccessPersonResponseInvalid extends Schema.TaggedError<AccessPersonResponseInvalid>()(
  "AccessPersonResponseInvalid",
  {}
) {}

export class AccessPersonRequestFailed extends Schema.TaggedError<AccessPersonRequestFailed>()(
  "AccessPersonRequestFailed",
  {}
) {}

export interface BindAccessPersonOptions {
  readonly dataRoot: string
  readonly email: AccessPersonEmail
}

export interface LoginToInstallationOptions {
  readonly dataRoot: string
  readonly installationUrl: string
}

const bound = (
  personId: PersonId,
  email: AccessPersonEmail
): AccessPersonBinding => AccessPersonBinding.make({
  personId,
  email
})

export const bindAccessPerson = (options: BindAccessPersonOptions) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const installationPath = path.join(options.dataRoot, "installation.json")
  const stateUnreadable = (reason: string) => new LocalDaemonStateUnreadable({
    state: "installation",
    path: installationPath,
    reason
  })

  const exists = yield* fs.exists(installationPath).pipe(
    Effect.mapError(() => stateUnreadable("Unable to inspect installation state"))
  )
  if (!exists) {
    return yield* new LocalDaemonStateMissing({
      state: "installation",
      path: installationPath
    })
  }

  const contents = yield* fs.readFileString(installationPath).pipe(
    Effect.mapError(() => stateUnreadable("Unable to read installation state"))
  )
  const installation = yield* Effect.try({
    try: () => decodeStored(LocalInstallation, contents),
    catch: () => new LocalDaemonStateMalformed({
      state: "installation",
      path: installationPath,
      reason: "Stored JSON does not match the required schema"
    })
  })
  const existingEmail = installation.principal.person.email
  if (existingEmail._tag === "access") {
    if (existingEmail.address !== options.email.address) {
      return yield* new AccessPersonAlreadyBound({
        existingAddress: existingEmail.address,
        requestedAddress: options.email.address
      })
    }
    return bound(installation.principal.person.personId, existingEmail)
  }

  const rewritten = LocalInstallation.make({
    ...installation,
    principal: PersonPrincipal.make({
      ...installation.principal,
      person: PersonSnapshot.make({
        ...installation.principal.person,
        email: options.email
      })
    })
  })
  const temporaryPath = path.join(
    options.dataRoot,
    `.installation-login-${installation.installationId}.tmp`
  )
  yield* Effect.scoped(Effect.gen(function*() {
    const file = yield* fs.open(temporaryPath, { flag: "wx", mode: 0o600 })
    yield* file.writeAll(new TextEncoder().encode(
      encodeStored(LocalInstallation, rewritten)
    ))
    yield* file.sync
    yield* fs.rename(temporaryPath, installationPath)
  })).pipe(
    Effect.ensuring(fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
    Effect.mapError(() => stateUnreadable("Unable to update installation state"))
  )
  yield* fs.chmod(installationPath, 0o600).pipe(
    Effect.mapError(() => stateUnreadable("Unable to secure installation state"))
  )

  return bound(rewritten.principal.person.personId, options.email)
})

const identityUrl = (
  installationUrl: string
): Effect.Effect<string, InstallationUrlInvalid> => Effect.try({
  try: () => {
    const url = new URL(installationUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported installation URL protocol")
    }
    return `${url.origin}/identity`
  },
  catch: () => new InstallationUrlInvalid({ installationUrl })
})

export const loginToInstallation = (
  options: LoginToInstallationOptions
) => Effect.gen(function*() {
  const url = yield* identityUrl(options.installationUrl)
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get(url)).pipe(
    Effect.mapError(() => new AccessPersonRequestFailed({}))
  )
  if (response.status === 401) {
    return yield* new AccessPersonUnauthenticated({})
  }
  if (response.status !== 200) {
    return yield* new AccessPersonResponseRejected({ status: response.status })
  }
  const contents = yield* response.text.pipe(
    Effect.mapError(() => new AccessPersonResponseInvalid({}))
  )
  const wire = yield* Effect.try({
    try: () => decodeAccessAuthenticatedPersonWire(JSON.parse(contents)),
    catch: () => new AccessPersonResponseInvalid({})
  })
  return yield* bindAccessPerson({
    dataRoot: options.dataRoot,
    email: AccessPersonEmail.make({
      _tag: "access",
      address: wire.address
    })
  })
}).pipe(Effect.provide(FetchHttpClient.layer))
