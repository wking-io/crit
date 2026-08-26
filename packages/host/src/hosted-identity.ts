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
  type EmailAddress
} from "@crit/domain"
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

export const hostedPersonPrincipal = (
  client: HostedReviewClientService
): Effect.Effect<PersonPrincipal, HostedReviewFailure> => Effect.gen(function*() {
  const address = yield* client.identity()
  const personId = yield* personIdFromEmail(address)
  const subject = yield* Schema.decodeUnknownEffect(AuthSubject)(
    `access|${address}`
  ).pipe(
    Effect.mapError(() => new HostedReviewUnreachable({
      reason: "The hosted identity is invalid."
    }))
  )
  return PersonPrincipal.make({
    subject,
    person: PersonSnapshot.make({
      personId,
      displayName: address.slice(0, address.indexOf("@")),
      email: AccessPersonEmail.make({ address })
    })
  })
})
