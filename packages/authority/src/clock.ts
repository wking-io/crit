import { IsoTimestamp } from "@crit/domain"
import { Clock, Effect, Schema } from "effect"

export const AuthorityClock = {
  now: Clock.currentTimeMillis.pipe(
    Effect.map((millis) => Schema.decodeUnknownSync(IsoTimestamp)(new Date(millis).toISOString()))
  )
}
