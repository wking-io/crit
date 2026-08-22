import { IsoTimestamp } from "@crit/domain"
import { Clock, Context, Effect, Layer, Schema } from "effect"

export class AuthorityClock extends Context.Service<AuthorityClock, {
  readonly now: Effect.Effect<typeof IsoTimestamp.Type>
}>()("@crit/authority/AuthorityClock") {}

export const AuthorityClockLive = Layer.succeed(AuthorityClock, {
  now: Clock.currentTimeMillis.pipe(
    Effect.map((millis) => Schema.decodeUnknownSync(IsoTimestamp)(new Date(millis).toISOString()))
  )
})

export const authorityClockLayer = (now: Effect.Effect<typeof IsoTimestamp.Type>) =>
  Layer.succeed(AuthorityClock, { now })
