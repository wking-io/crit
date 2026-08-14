import type { Schema } from "effect"

export function migrateLegacyPlaygroundCanvas(
  value: Schema.Json,
  author: Readonly<{ id: string; name: string }>
): Schema.Json
