import { EmailAddress, PersonId } from "@crit/domain"
import { Schema } from "effect"

export const critPersonCookieName = "crit_person"
export const critPersonIdHeader = "Crit-Person-Id"

export const AccessAuthenticatedPersonWire = Schema.Struct({
  kind: Schema.Literal("access-authenticated-person"),
  schemaVersion: Schema.Literal(1),
  address: EmailAddress
})
export type AccessAuthenticatedPersonWire = typeof AccessAuthenticatedPersonWire.Type

export const AnonymousPersonWire = Schema.Struct({
  kind: Schema.Literal("anonymous-person"),
  schemaVersion: Schema.Literal(1),
  personId: PersonId
})
export type AnonymousPersonWire = typeof AnonymousPersonWire.Type

export const InstallationPersonWire = Schema.Union([
  AccessAuthenticatedPersonWire,
  AnonymousPersonWire
])
export type InstallationPersonWire = typeof InstallationPersonWire.Type

export const decodeAccessAuthenticatedPersonWire = Schema.decodeUnknownSync(
  AccessAuthenticatedPersonWire,
  { onExcessProperty: "error" }
)

export const encodeAccessAuthenticatedPersonWire = Schema.encodeSync(
  AccessAuthenticatedPersonWire,
  { onExcessProperty: "error" }
)

export const decodeAnonymousPersonWire = Schema.decodeUnknownSync(
  AnonymousPersonWire,
  { onExcessProperty: "error" }
)

export const encodeAnonymousPersonWire = Schema.encodeSync(
  AnonymousPersonWire,
  { onExcessProperty: "error" }
)

export const decodeInstallationPersonWire = Schema.decodeUnknownSync(
  InstallationPersonWire,
  { onExcessProperty: "error" }
)

export const encodeInstallationPersonWire = Schema.encodeSync(
  InstallationPersonWire,
  { onExcessProperty: "error" }
)
