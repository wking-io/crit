import type { CanvasId } from "@crit/domain"
import { Option, Schema } from "effect"

export interface BrowserSessionStorage {
  readonly getItem: (key: string) => string | null
  readonly removeItem: (key: string) => void
  readonly setItem: (key: string, value: string) => void
}

const SessionEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  value: Schema.Json
})

export const browserSessionStorage = (): BrowserSessionStorage | undefined => {
  try {
    return globalThis.document?.defaultView?.sessionStorage
  } catch {
    return undefined
  }
}

export const sessionPreferenceKey = (args: {
  readonly canvasId: CanvasId
  readonly name: string
}): string =>
  `crit:session:${encodeURIComponent(args.canvasId)}:${encodeURIComponent(args.name)}`

export const readSessionPreference = <S extends Schema.ConstraintDecoder<unknown>>(args: {
  readonly storage: BrowserSessionStorage
  readonly key: string
  readonly schema: S
}): S["Type"] | undefined => {
  let source: string | null
  try {
    source = args.storage.getItem(args.key)
  } catch {
    return undefined
  }
  if (source === null) return undefined
  const envelope = Schema.decodeUnknownOption(Schema.fromJsonString(SessionEnvelope))(source)
  if (Option.isNone(envelope)) return undefined
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(args.schema)(envelope.value.value)
  )
}

export const writeSessionPreference = <S extends Schema.ConstraintEncoder<unknown>>(args: {
  readonly storage: BrowserSessionStorage
  readonly key: string
  readonly schema: S
  readonly value: S["Type"]
}): boolean => {
  try {
    const encoded = Schema.decodeUnknownSync(Schema.Json)(
      Schema.encodeUnknownSync(args.schema)(args.value)
    )
    args.storage.setItem(args.key, JSON.stringify({
      schemaVersion: 1,
      value: encoded
    } satisfies typeof SessionEnvelope.Type))
    return true
  } catch {
    return false
  }
}

export const clearSessionPreference = (args: {
  readonly storage: BrowserSessionStorage
  readonly key: string
}): boolean => {
  try {
    args.storage.removeItem(args.key)
    return true
  } catch {
    return false
  }
}
