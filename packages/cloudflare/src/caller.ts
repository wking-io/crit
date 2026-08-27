import { AuthSubject, EmailAddress, Id, PersonId } from "@crit/domain"
import {
  critPersonCookieName,
  critPersonIdHeader,
  type SubmitInvocation
} from "@crit/protocol"
import { Data, Match, Option, Predicate, Schema } from "effect"

import { readAccessEmail } from "./access.js"

export type CallerIdentity = Data.TaggedEnum<{
  readonly access: { readonly address: EmailAddress }
  readonly anonymous: { readonly personId: PersonId }
}>
export const CallerIdentity = Data.taggedEnum<CallerIdentity>()

export type ResolvedCaller = {
  readonly caller: CallerIdentity
  readonly mintedPersonId?: PersonId
}

export const mintAnonymousPersonId = (): PersonId =>
  Id.person(`person_${crypto.randomUUID()}`)

const decodePersonId = (value: string): PersonId | undefined => {
  const decoded = Schema.decodeUnknownOption(PersonId)(value)
  return Option.isSome(decoded) ? decoded.value : undefined
}

const readCookieValue = (request: Request, name: string): string | undefined => {
  const header = request.headers.get("Cookie")
  if (header === null) return undefined
  for (const part of header.split(";")) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf("=")
    if (separator === -1) continue
    if (trimmed.slice(0, separator) !== name) continue
    return decodeURIComponent(trimmed.slice(separator + 1))
  }
  return undefined
}

const readAnonymousPersonId = (request: Request): PersonId | undefined => {
  const header = request.headers.get(critPersonIdHeader)
  if (header !== null) {
    const decoded = decodePersonId(header.trim())
    if (decoded !== undefined) return decoded
  }
  const cookie = readCookieValue(request, critPersonCookieName)
  if (cookie === undefined) return undefined
  return decodePersonId(cookie)
}

export const resolveCallerIdentity = (request: Request): ResolvedCaller => {
  const address = readAccessEmail(request)
  if (Option.isSome(address)) {
    return { caller: CallerIdentity.access({ address: address.value }) }
  }
  const personId = readAnonymousPersonId(request)
  if (personId !== undefined) {
    return { caller: CallerIdentity.anonymous({ personId }) }
  }
  const mintedPersonId = mintAnonymousPersonId()
  return {
    caller: CallerIdentity.anonymous({ personId: mintedPersonId }),
    mintedPersonId
  }
}

export const applyAnonymousPersonCookie = (
  response: Response,
  request: Request,
  resolved: ResolvedCaller
): Response => {
  if (resolved.mintedPersonId === undefined) return response
  const secure = new URL(request.url).protocol === "https:"
  const cookie = [
    `${critPersonCookieName}=${encodeURIComponent(resolved.mintedPersonId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=31536000",
    ...(secure ? ["Secure"] : [])
  ].join("; ")
  const headers = new Headers(response.headers)
  headers.append("Set-Cookie", cookie)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export const respondWithCallerCookie = (
  response: Response,
  request: Request,
  resolved: ResolvedCaller
): Response => applyAnonymousPersonCookie(response, request, resolved)

export const authSubjectForCaller = (caller: CallerIdentity): AuthSubject =>
  CallerIdentity.$is("access")(caller)
    ? Schema.decodeUnknownSync(AuthSubject)(`access|${caller.address}`)
    : Schema.decodeUnknownSync(AuthSubject)(`anonymous|${caller.personId}`)

const invocationPerson = (invocation: SubmitInvocation) =>
  Match.value(invocation).pipe(
    Match.tagsExhaustive({
      person: ({ principal }) => principal.person,
      agent: ({ principal }) => principal.delegatedBy
    })
  )

export const callerMatchesInvocation = (
  caller: CallerIdentity,
  invocation: SubmitInvocation
): boolean => {
  const person = invocationPerson(invocation)
  return CallerIdentity.$is("access")(caller)
    ? Predicate.isTagged(person.email, "access") && "address" in person.email
      && person.email.address === caller.address
    : Predicate.isTagged(person.email, "unspecified") && person.personId === caller.personId
}
