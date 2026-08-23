import type { CanvasId } from "@crit/domain"
import { Data, Effect, Layer, Option, Schema } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

export class SessionStorageUnavailable extends Data.TaggedError("SessionStorageUnavailable")<{
  readonly reason: "missing" | "blocked"
}> {}

const SESSION_PREFIX = "crit:session:"

const SessionEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  value: Schema.Json
})

const preferenceId = (canvasId: CanvasId, name: string): string =>
  `${encodeURIComponent(canvasId)}:${encodeURIComponent(name)}`

export const sessionPreferenceKey = (args: {
  readonly canvasId: CanvasId
  readonly name: string
}): string => `${SESSION_PREFIX}${preferenceId(args.canvasId, args.name)}`

const sessions = Effect.map(
  KeyValueStore.KeyValueStore,
  (store) => KeyValueStore.prefix(store, SESSION_PREFIX)
)

const envelopes = Effect.map(
  sessions,
  (store) => KeyValueStore.toSchemaStore(store, SessionEnvelope)
)

export const layerMemory = KeyValueStore.layerMemory

export const layerStorage = KeyValueStore.layerStorage

const readSessionStorage = Effect.try({
  try: () => globalThis.document?.defaultView?.sessionStorage,
  catch: () => new SessionStorageUnavailable({ reason: "blocked" })
}).pipe(Effect.flatMap((storage) =>
  storage === undefined
    ? Effect.fail(new SessionStorageUnavailable({ reason: "missing" }))
    : Effect.succeed(storage)
))

export const layerSessionStorage: Layer.Layer<
  KeyValueStore.KeyValueStore,
  SessionStorageUnavailable
> = Layer.unwrap(
  Effect.map(readSessionStorage, (storage) => KeyValueStore.layerStorage(() => storage))
)

export const getSessionPreference = <S extends Schema.ConstraintDecoder<unknown>>(args: {
  readonly canvasId: CanvasId
  readonly name: string
  readonly schema: S
}): Effect.Effect<S["Type"] | undefined, never, KeyValueStore.KeyValueStore> =>
  Effect.gen(function*() {
    const store = yield* envelopes
    const record = yield* store.get(preferenceId(args.canvasId, args.name))
    if (Option.isNone(record)) return undefined
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(args.schema)(record.value.value)
    )
  }).pipe(Effect.orElseSucceed(() => undefined))

export const setSessionPreference = <S extends Schema.ConstraintEncoder<unknown>>(args: {
  readonly canvasId: CanvasId
  readonly name: string
  readonly schema: S
  readonly value: S["Type"]
}): Effect.Effect<void, KeyValueStore.KeyValueStoreError | Schema.SchemaError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function*() {
    const store = yield* envelopes
    const encoded = Schema.decodeUnknownSync(Schema.Json)(
      Schema.encodeUnknownSync(args.schema)(args.value)
    )
    yield* store.set(preferenceId(args.canvasId, args.name), {
      schemaVersion: 1,
      value: encoded
    })
  })

export const removeSessionPreference = (args: {
  readonly canvasId: CanvasId
  readonly name: string
}): Effect.Effect<void, KeyValueStore.KeyValueStoreError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function*() {
    const store = yield* sessions
    yield* store.remove(preferenceId(args.canvasId, args.name))
  })
