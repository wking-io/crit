import type { VerifiedInvocation } from "@crit/authority"
import { BrowserOrigin } from "@crit/client"
import type { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Crypto, Data, Effect, Encoding, Redacted, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { createHash, timingSafeEqual } from "node:crypto"

import type { BrowserSessionService } from "./browser-session.js"

export const HostToken = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{86}$/)
).pipe(Schema.brand("HostToken"))
export type HostToken = typeof HostToken.Type

export type BrowserAttachment = Data.TaggedEnum<{
  readonly None: {}
  readonly Integrated: { readonly plane: IntegratedHostPlane }
  readonly Standalone: { readonly session: BrowserSessionService }
}>

export interface IntegratedHostPlane {
  readonly hostOrigin: BrowserOrigin
  readonly daemonOrigin: string
  readonly instance: LocalDaemonInstanceNonce
  readonly hostToken: Redacted.Redacted<HostToken>
  readonly invocation: VerifiedInvocation
}

export type DevHostRequest = Data.TaggedEnum<{
  readonly None: {}
  readonly Integrated: { readonly hostOrigin: string }
  readonly Standalone: { readonly browserOrigin: string }
}>

export const BrowserAttachment = Data.taggedEnum<BrowserAttachment>()
export const DevHostRequest = Data.taggedEnum<DevHostRequest>()

export const hostTokenHeader = "x-crit-host-token"

const tokenDigest = (value: string) => createHash("sha256").update(value).digest()

export const mintIntegratedPlane = (options: {
  readonly hostOrigin: BrowserOrigin
  readonly daemonOrigin: string
  readonly instance: LocalDaemonInstanceNonce
  readonly invocation: VerifiedInvocation
}): Effect.Effect<IntegratedHostPlane, never, Crypto.Crypto> =>
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const hostToken = Schema.decodeUnknownSync(HostToken)(
      Encoding.encodeBase64Url(yield* crypto.randomBytes(64))
    )
    return {
      hostOrigin: options.hostOrigin,
      daemonOrigin: options.daemonOrigin,
      instance: options.instance,
      hostToken: Redacted.make(hostToken),
      invocation: options.invocation
    }
  })

export const authorizeIntegrated = (
  request: HttpServerRequest.HttpServerRequest,
  plane: IntegratedHostPlane
): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const origin = request.headers.origin
    const token = request.headers[hostTokenHeader]
    if (origin !== plane.hostOrigin || typeof token !== "string") return false
    const expected = tokenDigest(Redacted.value(plane.hostToken))
    const actual = tokenDigest(token)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  })
