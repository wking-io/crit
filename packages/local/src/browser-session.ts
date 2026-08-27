import type { VerifiedInvocation } from "@crit/authority"
import {
  BrowserOrigin,
  LocalBrowserConnection,
  type LocalBrowserConnectionDescriptor
} from "@crit/client"
import type { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Context, Crypto, Data, Effect, Encoding, Layer, Redacted, Ref, Schema } from "effect"

export { BrowserOrigin }
export type { BrowserOrigin }

export const BrowserCapability = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)
).pipe(Schema.brand("BrowserCapability"))
type BrowserCapability = typeof BrowserCapability.Type

const BrowserSessionSecret = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)
).pipe(Schema.brand("BrowserSessionSecret"))
type BrowserSessionSecret = typeof BrowserSessionSecret.Type

const BrowserDigest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/)
).pipe(Schema.brand("BrowserDigest"))
type BrowserDigest = typeof BrowserDigest.Type

type BrowserAuthState = Data.TaggedEnum<{
  readonly awaitingBootstrap: { readonly bootstrapDigest: BrowserDigest }
  readonly bootstrapped: { readonly sessionDigest: BrowserDigest }
}>
const BrowserAuthState = Data.taggedEnum<BrowserAuthState>()

type BrowserExchange = Data.TaggedEnum<{
  readonly accepted: { readonly session: BrowserSessionSecret }
  readonly rejected: {}
}>
const BrowserExchange = Data.taggedEnum<BrowserExchange>()

export interface BrowserSessionOptions {
  readonly daemonOrigin: BrowserOrigin
  readonly instance: LocalDaemonInstanceNonce
  readonly browserOrigin: BrowserOrigin
  readonly invocation: VerifiedInvocation
}

export interface BrowserSessionService {
  readonly bootstrapUrl: Redacted.Redacted<string>
  readonly connection: LocalBrowserConnectionDescriptor
  readonly browserOrigin: BrowserOrigin
  readonly daemonOrigin: string
  readonly host: string
  readonly path: `/${string}`
  readonly cookieName: string
  readonly invocation: VerifiedInvocation
  readonly exchange: (capability: string) => Effect.Effect<BrowserExchange>
  readonly authorize: (session: string) => Effect.Effect<boolean>
}

export class BrowserSession extends Context.Service<BrowserSession, BrowserSessionService>()(
  "@crit/local/BrowserSession"
) {
  static readonly layer = (options: BrowserSessionOptions) => Layer.effect(
    BrowserSession,
    Effect.gen(function*() {
      const crypto = yield* Crypto.Crypto
      const digest = (value: string) => crypto.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      ).pipe(
        Effect.map((bytes) => Schema.decodeUnknownSync(BrowserDigest)(Encoding.encodeHex(bytes))),
        Effect.orDie
      )
      const capability = Schema.decodeUnknownSync(BrowserCapability)(
        Encoding.encodeBase64Url(yield* crypto.randomBytes(64))
      )
      const state = yield* Ref.make<BrowserAuthState>(
        BrowserAuthState.awaitingBootstrap({
          bootstrapDigest: yield* digest(capability)
        })
      )
      const connection = LocalBrowserConnection.make({
        baseUrl: options.browserOrigin,
        instance: options.instance
      })
      const daemonUrl = new URL(options.daemonOrigin)
      const path = connection.browserPath
      const cookieName = `crit_session_${options.instance}`

      return BrowserSession.of({
        bootstrapUrl: Redacted.make(`${options.browserOrigin}${path}#${capability}`),
        connection,
        browserOrigin: options.browserOrigin,
        daemonOrigin: daemonUrl.origin,
        host: daemonUrl.host,
        path,
        cookieName,
        invocation: options.invocation,
        exchange: (candidate) => Effect.gen(function*() {
          const candidateDigest = yield* digest(candidate)
          const session = Schema.decodeUnknownSync(BrowserSessionSecret)(
            Encoding.encodeBase64Url(yield* crypto.randomBytes(64).pipe(Effect.orDie))
          )
          const sessionDigest = yield* digest(session)
          return yield* Ref.modify(state, (current): readonly [
            BrowserExchange,
            BrowserAuthState
          ] => {
            if (
              BrowserAuthState.$is("awaitingBootstrap")(current) &&
              current.bootstrapDigest === candidateDigest
            ) {
              return [
                BrowserExchange.accepted({ session }),
                BrowserAuthState.bootstrapped({ sessionDigest })
              ]
            }
            return [BrowserExchange.rejected(), current]
          })
        }),
        authorize: (session) => Effect.gen(function*() {
          const sessionDigest = yield* digest(session)
          return yield* Ref.get(state).pipe(Effect.map((current) =>
            BrowserAuthState.$is("bootstrapped")(current) && current.sessionDigest === sessionDigest
          ))
        })
      })
    })
  )
}
