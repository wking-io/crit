import { AuthSubject, EmailAddress, Id, PersonId } from "@crit/domain"
import type { SubmitInvocation } from "@crit/protocol"
import { Data, Option, Schema } from "effect"

import { readAccessEmail } from "./access.js"

export const anonymousPersonId = Id.person("person_anonymous")

export type CallerIdentity = Data.TaggedEnum<{
  readonly access: { readonly address: EmailAddress }
  readonly anonymous: { readonly personId: PersonId }
}>
export const CallerIdentity = Data.taggedEnum<CallerIdentity>()

export const resolveCallerIdentity = (request: Request): CallerIdentity => {
  const address = readAccessEmail(request)
  return Option.isSome(address)
    ? CallerIdentity.access({ address: address.value })
    : CallerIdentity.anonymous({ personId: anonymousPersonId })
}

export const authSubjectForCaller = (caller: CallerIdentity): AuthSubject =>
  caller._tag === "access"
    ? Schema.decodeUnknownSync(AuthSubject)(`access|${caller.address}`)
    : Schema.decodeUnknownSync(AuthSubject)(`anonymous|${caller.personId}`)

export const callerMatchesInvocation = (
  caller: CallerIdentity,
  invocation: SubmitInvocation
): boolean => {
  const email = invocation._tag === "person"
    ? invocation.principal.person.email
    : invocation.principal.delegatedBy.email
  return caller._tag === "access"
    ? email._tag === "access" && email.address === caller.address
    : email._tag === "unspecified"
}
