import { Schema } from "effect"

import { PersonSnapshot } from "./identity.js"
import { CanvasId } from "./ids.js"

export const ConnectedPerson = Schema.TaggedStruct("connectedPerson", {
  person: PersonSnapshot
})
export type ConnectedPerson = typeof ConnectedPerson.Type

export const PresenceKey = Schema.String.check(
  Schema.isPattern(/^person:[A-Za-z0-9_-]+$/)
).pipe(Schema.brand("PresenceKey"))
export type PresenceKey = typeof PresenceKey.Type

export const presenceKey = ({ person }: ConnectedPerson): PresenceKey =>
  Schema.decodeUnknownSync(PresenceKey)(`person:${person.personId}`)

const PresenceRosterFields = Schema.TaggedStruct("presenceRoster", {
  canvasId: CanvasId,
  people: Schema.Array(ConnectedPerson)
})

const duplicatePresenceIdentity = (
  roster: typeof PresenceRosterFields.Type
): string | undefined => {
  const personIds = roster.people.map(({ person }) => person.personId)
  return new Set(personIds).size === personIds.length
    ? undefined
    : "Expected unique personId values in people"
}

export const PresenceRoster = PresenceRosterFields.check(
  Schema.makeFilter<typeof PresenceRosterFields.Type>(duplicatePresenceIdentity)
)
export type PresenceRoster = typeof PresenceRoster.Type

export const decodePresenceRoster = (input: Schema.Json): PresenceRoster =>
  Schema.decodeUnknownSync(
    PresenceRoster,
    { onExcessProperty: "error" }
  )(input)
