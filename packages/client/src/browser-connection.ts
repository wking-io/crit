import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Encoding, Result, Schema } from "effect"

import type { LocalClientOptions } from "./index.js"

const LocalDaemonBaseUrl = Schema.String.check(Schema.isPattern(
  /^http:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/
))

const LocalBrowserPath = Schema.TemplateLiteral(["/browser/", LocalDaemonInstanceNonce, "/"])

export const LocalBrowserConnectionDescriptor = Schema.TaggedStruct("local-browser-connection", {
  schemaVersion: Schema.Literal(1),
  baseUrl: LocalDaemonBaseUrl,
  browserPath: LocalBrowserPath
})
export type LocalBrowserConnectionDescriptor = typeof LocalBrowserConnectionDescriptor.Type

const LocalBrowserConnectionInvalidReason = Schema.Literals([
  "fragment-too-large",
  "fragment-missing",
  "fragment-not-base64url",
  "descriptor-invalid"
])
type LocalBrowserConnectionInvalidReason = typeof LocalBrowserConnectionInvalidReason.Type

export class LocalBrowserConnectionInvalid extends Schema.TaggedError<LocalBrowserConnectionInvalid>()(
  "LocalBrowserConnectionInvalid",
  { reason: LocalBrowserConnectionInvalidReason }
) {}

const fragmentPrefix = "#crit="
const maximumFragmentLength = 2_048
const descriptorJson = Schema.fromJsonString(LocalBrowserConnectionDescriptor)

const invalid = (reason: LocalBrowserConnectionInvalidReason) =>
  Result.fail(new LocalBrowserConnectionInvalid({ reason }))

const make = ({
  baseUrl,
  instance
}: {
  readonly baseUrl: string
  readonly instance: LocalDaemonInstanceNonce
}) =>
  Schema.decodeUnknownSync(LocalBrowserConnectionDescriptor, { onExcessProperty: "error" })({
    _tag: "local-browser-connection",
    schemaVersion: 1,
    baseUrl,
    browserPath: `/browser/${instance}/`
  })

const encode = (descriptor: LocalBrowserConnectionDescriptor) =>
  `${fragmentPrefix}${Encoding.encodeBase64Url(Schema.encodeSync(descriptorJson)(descriptor))}`

const decode = (
  fragment: string
): Result.Result<LocalBrowserConnectionDescriptor, LocalBrowserConnectionInvalid> => {
  if (fragment.length > maximumFragmentLength) return invalid("fragment-too-large")
  if (!fragment.startsWith(fragmentPrefix) || fragment.length === fragmentPrefix.length) {
    return invalid("fragment-missing")
  }
  return Encoding.decodeBase64UrlString(fragment.slice(fragmentPrefix.length)).pipe(
    Result.mapError(() => new LocalBrowserConnectionInvalid({ reason: "fragment-not-base64url" })),
    Result.flatMap((json) => Schema.decodeUnknownResult(
      descriptorJson,
      { onExcessProperty: "error" }
    )(json).pipe(
      Result.mapError(() => new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }))
    ))
  )
}

const options = (
  descriptor: LocalBrowserConnectionDescriptor
): Extract<LocalClientOptions, { readonly _tag: "browser-session" }> => ({
  _tag: "browser-session",
  baseUrl: descriptor.baseUrl,
  browserPath: descriptor.browserPath
})

export const LocalBrowserConnection = { make, encode, decode, options }
