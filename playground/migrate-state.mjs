import { Option, Schema } from "effect"

const PlaygroundAuthor = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

const LegacyPlaygroundNote = Schema.StructWithRest(
  Schema.Struct({
    author: Schema.optionalKey(Schema.Unknown)
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

const LegacyPlaygroundCanvas = Schema.StructWithRest(
  Schema.Struct({
    format: Schema.Literal("crit-canvas"),
    version: Schema.Literal(1),
    notes: Schema.Array(Schema.Unknown),
    owner: Schema.optionalKey(Schema.NullOr(Schema.Undefined))
  }),
  [Schema.Record(Schema.String, Schema.Unknown)]
)

const LegacyPlaygroundCanvasCandidate = Schema.Struct({
  format: Schema.Literal("crit-canvas"),
  version: Schema.Literal(1),
  owner: Schema.optionalKey(Schema.NullOr(Schema.Undefined))
})

const decodePlaygroundAuthor = Schema.decodeUnknownSync(PlaygroundAuthor)
const decodeLegacyPlaygroundCanvasCandidate = Schema.decodeUnknownOption(
  LegacyPlaygroundCanvasCandidate
)
const decodeLegacyPlaygroundCanvas = Schema.decodeUnknownSync(
  LegacyPlaygroundCanvas
)
const decodeLegacyPlaygroundNote = Schema.decodeUnknownOption(
  LegacyPlaygroundNote
)

/**
 * Adds identity fields introduced after the first playground Canvas format.
 * Returns the original value when it is not the known legacy shape.
 */
export const migrateLegacyPlaygroundCanvas = (value, author) => {
  if (Option.isNone(decodeLegacyPlaygroundCanvasCandidate(value))) return value

  const candidate = decodeLegacyPlaygroundCanvas(value)
  const decodedAuthor = decodePlaygroundAuthor(author)

  return {
    ...candidate,
    owner: decodedAuthor,
    notes: candidate.notes.map((note) => {
      const legacyNote = decodeLegacyPlaygroundNote(note)
      return Option.isSome(legacyNote) && legacyNote.value.author === undefined
        ? { ...legacyNote.value, author: decodedAuthor }
        : note
    })
  }
}
