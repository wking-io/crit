import {
  ApplicationRouteRepresentation,
  HttpUrl
} from "@crit/domain"
import { Schema } from "effect"

export const hostedApplicationResolvePath =
  "/representations/application-route" as const

export const HostedApplicationResolveRequest = Schema.Struct({
  kind: Schema.Literal("resolveApplicationRoute"),
  schemaVersion: Schema.Literal(1),
  representation: ApplicationRouteRepresentation
})
export type HostedApplicationResolveRequest =
  typeof HostedApplicationResolveRequest.Type

const HostedApplicationIframePlan = Schema.TaggedStruct("iframe", {
  representation: ApplicationRouteRepresentation,
  url: HttpUrl
})

const HostedApplicationUnavailablePlan = Schema.TaggedStruct("unavailable", {
  reason: Schema.Literal("application-unbound"),
  representation: ApplicationRouteRepresentation
})

export const HostedApplicationResolveResponse = Schema.Union([
  HostedApplicationIframePlan,
  HostedApplicationUnavailablePlan
])
export type HostedApplicationResolveResponse =
  typeof HostedApplicationResolveResponse.Type

export const decodeHostedApplicationResolveRequest = Schema.decodeUnknownSync(
  HostedApplicationResolveRequest,
  { onExcessProperty: "error" }
)

export const encodeHostedApplicationResolveRequest = Schema.encodeSync(
  HostedApplicationResolveRequest,
  { onExcessProperty: "error" }
)

export const decodeHostedApplicationResolveResponse = Schema.decodeUnknownSync(
  HostedApplicationResolveResponse,
  { onExcessProperty: "error" }
)

export const encodeHostedApplicationResolveResponse = Schema.encodeSync(
  HostedApplicationResolveResponse,
  { onExcessProperty: "error" }
)
