import { Schema } from "effect"

declare const structuredClone: <A>(value: A) => A

const CursorSchema = Schema.String.check(
  Schema.isPattern(/^cursor_[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/)
).pipe(Schema.brand("Cursor"))
export type Cursor = typeof CursorSchema.Type

const SequenceSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("Sequence"))
export type Sequence = typeof SequenceSchema.Type

export const ProtocolValue = {
  cursor: Schema.decodeUnknownSync(CursorSchema),
  sequence: Schema.decodeUnknownSync(SequenceSchema),
  detach: <A>(value: A): A => structuredClone(value)
}

export { CursorSchema, SequenceSchema }
