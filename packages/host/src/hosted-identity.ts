import {
  HostedReviewUnreachable,
  type HostedReviewClientService,
  type HostedReviewFailure
} from "@crit/client"
import {
  AccessPersonEmail,
  AuthSubject,
  Id,
  PersonPrincipal,
  PersonSnapshot,
  UnspecifiedPersonEmail,
  type EmailAddress
} from "@crit/domain"
import type { InstallationPersonWire } from "@crit/protocol"
import { Effect, Schema } from "effect"

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

const personIdFromEmail = (
  address: EmailAddress
): Effect.Effect<ReturnType<typeof Id.person>, HostedReviewFailure> =>
  Effect.tryPromise({
    try: async() => {
      const input = new TextEncoder().encode(address)
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", input)
      )
      return Id.person(`person_${hex(digest).slice(0, 32)}`)
    },
    catch: () => new HostedReviewUnreachable({
      reason: "The hosted identity digest failed."
    })
  })

const principalFromInstallationPerson = (
  wire: InstallationPersonWire
): Effect.Effect<PersonPrincipal, HostedReviewFailure> => {
  if (wire.kind === "access-authenticated-person") {
    return Effect.gen(function*() {
      const personId = yield* personIdFromEmail(wire.address)
      const subject = yield* Schema.decodeUnknownEffect(AuthSubject)(
        `access|${wire.address}`
      ).pipe(
        Effect.mapError(() => new HostedReviewUnreachable({
          reason: "The hosted identity is invalid."
        }))
      )
      return PersonPrincipal.make({
        subject,
        person: PersonSnapshot.make({
          personId,
          displayName: wire.address.slice(0, wire.address.indexOf("@")),
          email: AccessPersonEmail.make({ address: wire.address })
        })
      })
    })
  }
  return Effect.gen(function*() {
    const subject = yield* Schema.decodeUnknownEffect(AuthSubject)(
      `anonymous|${wire.personId}`
    ).pipe(
      Effect.mapError(() => new HostedReviewUnreachable({
        reason: "The hosted identity is invalid."
      }))
    )
    return PersonPrincipal.make({
      subject,
      person: PersonSnapshot.make({
        personId: wire.personId,
        displayName: "Anonymous",
        email: UnspecifiedPersonEmail.make({})
      })
    })
  })
}

export const hostedPersonPrincipal = (
  client: HostedReviewClientService
): Effect.Effect<PersonPrincipal, HostedReviewFailure> => Effect.gen(function*() {
  const wire = yield* client.identity()
  return yield* principalFromInstallationPerson(wire)
})
