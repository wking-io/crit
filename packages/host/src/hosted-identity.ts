import {
  HostedReviewUnreachable,
  type HostedReviewClientService,
  type HostedReviewFailure
} from "@crit/client"
import {
  accessPersonSnapshot,
  AuthSubject,
  PersonPrincipal,
  PersonSnapshot,
  UnspecifiedPersonEmail
} from "@crit/domain"
import type { InstallationPersonWire } from "@crit/protocol"
import { Effect, Schema } from "effect"

const principalFromInstallationPerson = (
  wire: InstallationPersonWire
): Effect.Effect<PersonPrincipal, HostedReviewFailure> => {
  if (wire.kind === "access-authenticated-person") {
    return Effect.gen(function*() {
      const person = yield* accessPersonSnapshot(wire.address)
      const subject = yield* Schema.decodeUnknownEffect(AuthSubject)(
        `access|${wire.address}`
      ).pipe(
        Effect.mapError(() => new HostedReviewUnreachable({
          reason: "The hosted identity is invalid."
        }))
      )
      return PersonPrincipal.make({ subject, person })
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
