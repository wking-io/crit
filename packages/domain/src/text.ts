import { Schema } from "effect"

export const NonBlankString = Schema.Trimmed.check(Schema.isNonEmpty())
