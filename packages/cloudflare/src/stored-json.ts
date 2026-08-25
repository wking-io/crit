import { completeStoredPerson } from "@crit/domain"
import { Data, Effect, Schema } from "effect"

export const durableObjectSqlRowLimitBytes = 2 * 1024 * 1024

export class DurableSqlRowLimitExceeded extends Data.TaggedError("DurableSqlRowLimitExceeded")<{
  readonly bytes: number
  readonly limit: number
}> {}

const textEncoder = new TextEncoder()

export const encodeDurableSqlText = (
  value: string
): Effect.Effect<string, DurableSqlRowLimitExceeded> => {
  const bytes = textEncoder.encode(value).byteLength
  return bytes <= durableObjectSqlRowLimitBytes
    ? Effect.succeed(value)
    : Effect.fail(new DurableSqlRowLimitExceeded({
      bytes,
      limit: durableObjectSqlRowLimitBytes
    }))
}

const parseJson = (value: string): Schema.Json =>
  Schema.decodeUnknownSync(Schema.Json)(JSON.parse(value))

export const decodeStored = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string
): S["Type"] => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(
  completeStoredPerson(parseJson(value))
)

export const encodeStored = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"]
): Effect.Effect<string, DurableSqlRowLimitExceeded> => encodeDurableSqlText(
  JSON.stringify(Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(schema)(value)))
)
