import type { VerifiedInvocation } from "@crit/authority"
import { Context, Crypto, Effect, Encoding, Layer, Redacted, Ref, Schema } from "effect"

export const BrowserCapability = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)
).pipe(Schema.brand("BrowserCapability"))
type BrowserCapability = typeof BrowserCapability.Type

export const BrowserOrigin = Schema.String.check(
  Schema.isPattern(/^http:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/)
).pipe(Schema.brand("BrowserOrigin"))
export type BrowserOrigin = typeof BrowserOrigin.Type

const BrowserSessionSecret = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)
).pipe(Schema.brand("BrowserSessionSecret"))
type BrowserSessionSecret = typeof BrowserSessionSecret.Type

const BrowserDigest = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/)
).pipe(Schema.brand("BrowserDigest"))
type BrowserDigest = typeof BrowserDigest.Type

type BrowserAuthState =
  | { readonly kind: "awaiting-bootstrap"; readonly bootstrapDigest: BrowserDigest }
  | { readonly kind: "bootstrapped"; readonly sessionDigest: BrowserDigest }

export interface BrowserSessionOptions {
  readonly baseUrl: string
  readonly instance: string
  readonly browserOrigin: BrowserOrigin
  readonly invocation: VerifiedInvocation
}

export interface BrowserSessionService {
  readonly bootstrapUrl: Redacted.Redacted<string>
  readonly browserOrigin: BrowserOrigin
  readonly daemonOrigin: string
  readonly host: string
  readonly path: `/${string}`
  readonly cookieName: string
  readonly invocation: VerifiedInvocation
  readonly exchange: (capability: string) => Effect.Effect<
    | { readonly kind: "accepted"; readonly session: BrowserSessionSecret }
    | { readonly kind: "rejected" }
  >
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
      const state = yield* Ref.make<BrowserAuthState>({
        kind: "awaiting-bootstrap",
        bootstrapDigest: yield* digest(capability)
      })
      const url = new URL(options.baseUrl)
      const path: `/${string}` = `/browser/${options.instance}/`
      const cookieName = `crit_session_${options.instance}`

      return BrowserSession.of({
        bootstrapUrl: Redacted.make(`${options.baseUrl}${path}#${capability}`),
        browserOrigin: options.browserOrigin,
        daemonOrigin: url.origin,
        host: url.host,
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
            | { readonly kind: "accepted"; readonly session: BrowserSessionSecret }
            | { readonly kind: "rejected" },
            BrowserAuthState
          ] => {
            if (
              current.kind === "awaiting-bootstrap" &&
              current.bootstrapDigest === candidateDigest
            ) {
              return [{ kind: "accepted", session }, { kind: "bootstrapped", sessionDigest }]
            }
            return [{ kind: "rejected" }, current]
          })
        }),
        authorize: (session) => Effect.gen(function*() {
          const sessionDigest = yield* digest(session)
          return yield* Ref.get(state).pipe(Effect.map((current) =>
            current.kind === "bootstrapped" && current.sessionDigest === sessionDigest
          ))
        })
      })
    })
  )
}
