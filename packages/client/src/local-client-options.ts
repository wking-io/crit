import type { LocalApiToken } from "@crit/replica/http"
import { Data } from "effect"

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
}>
export const LocalClientOptions = Data.taggedEnum<LocalClientOptions>()
