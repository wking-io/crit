import { Schema } from "effect"

const parseJson = (value: string): Schema.Json =>
  Schema.decodeUnknownSync(Schema.Json)(JSON.parse(value))

export const decodeStored = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string
): S["Type"] => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(parseJson(value))

export const encodeStored = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"]
): string => JSON.stringify(Schema.decodeUnknownSync(Schema.Json)(Schema.encodeUnknownSync(schema)(value)))
