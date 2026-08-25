import { EmailAddress } from "@crit/domain"
import { Schema } from "effect"

export const AccessAuthenticatedPersonWire = Schema.Struct({
  kind: Schema.Literal("access-authenticated-person"),
  schemaVersion: Schema.Literal(1),
  address: EmailAddress
})
export type AccessAuthenticatedPersonWire = typeof AccessAuthenticatedPersonWire.Type

export const decodeAccessAuthenticatedPersonWire = Schema.decodeUnknownSync(
  AccessAuthenticatedPersonWire,
  { onExcessProperty: "error" }
)

export const encodeAccessAuthenticatedPersonWire = Schema.encodeSync(
  AccessAuthenticatedPersonWire,
  { onExcessProperty: "error" }
)
