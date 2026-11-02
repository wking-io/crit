import type { LocalApiToken } from "@crit/replica/http"
import { Data, Schema } from "effect"

export const BrowserOrigin = Schema.String.check(
  Schema.isPattern(
    /^https?:\/\/(?:127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*localhost)(?::(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?$/
  )
).pipe(Schema.brand("BrowserOrigin"))
export type BrowserOrigin = typeof BrowserOrigin.Type

export const IntegratedApiBase = Schema.Literal("/__crit/")
export type IntegratedApiBase = typeof IntegratedApiBase.Type

export const IntegratedConnectionDocument = Schema.Struct({
  kind: Schema.Literal("integrated"),
  apiBase: IntegratedApiBase
})
export type IntegratedConnectionDocument = typeof IntegratedConnectionDocument.Type

export type LocalClientOptions = Data.TaggedEnum<{
  readonly bearer: {
    readonly baseUrl: string
    readonly token: LocalApiToken
    readonly origin?: string
  }
  readonly browserSession: {
    readonly baseUrl: string
    readonly browserPath: `/${string}/`
  }
  readonly integrated: {
    readonly origin: BrowserOrigin
    readonly apiBase: IntegratedApiBase
  }
}>
export const LocalClientOptions = Data.taggedEnum<LocalClientOptions>()

export const localPath = (options: LocalClientOptions, path: `/${string}`) => {
  if (LocalClientOptions.$is("bearer")(options)) return path
  if (LocalClientOptions.$is("integrated")(options)) {
    return `${options.apiBase}${path.slice(1)}`
  }
  return `${options.browserPath}${path.slice(1)}`
}
