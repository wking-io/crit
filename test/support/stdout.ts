import { Buffer } from "node:buffer"

import { Effect, Sink } from "effect"

export const collectStdout = (append: (value: string) => void) =>
  Sink.forEach((chunk: string | Uint8Array) =>
    Effect.sync(() => append(Buffer.from(chunk).toString("utf8")))
  )
