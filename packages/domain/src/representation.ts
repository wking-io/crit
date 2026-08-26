import { Schema } from "effect"

import {
  canonicalHttpPortFailure,
  publicDnsHostnameFailure
} from "./http-authority.js"
import {
  ApplicationId,
  ArtifactId,
  HttpUrl,
  Sha256Digest
} from "./ids.js"

const percentFailure = (value: string, label: string) => {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") continue
    const escape = value.slice(index + 1, index + 3)
    if (!/^[0-9A-F]{2}$/.test(escape)) {
      return `${label} percent escapes must use two uppercase hexadecimal digits`
    }
    const byte = Number.parseInt(escape, 16)
    if (byte <= 0x7f) {
      return `${label} cannot percent-encode an ASCII byte`
    }
    index += 2
  }
  return undefined
}

const routeQueryFailure = (query: string): string | undefined => {
  if (query.length === 0) return "A route cannot contain an empty query marker"
  const invalidPercent = percentFailure(query, "A route query")
  if (invalidPercent !== undefined) return invalidPercent
  try {
    decodeURIComponent(query)
  } catch {
    return "A route query must contain valid percent encoding"
  }
  return undefined
}

const routePathnameFailure = (pathname: string): string | undefined => {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return "A route pathname cannot end with a slash"
  }
  if (pathname.includes("//")) {
    return "A route pathname cannot contain an empty segment"
  }
  const invalidPathPercent = percentFailure(pathname, "A route pathname")
  if (invalidPathPercent !== undefined) return invalidPathPercent

  for (const segment of pathname.split("/")) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return "A route must contain valid percent encoding"
    }
    if (decoded === "." || decoded === "..") {
      return "A route pathname cannot contain dot segments"
    }
    if (decoded.includes("/") || decoded.includes("\\")) {
      return "A route segment cannot encode a path separator"
    }
  }
  return undefined
}

const routeFailure = (route: string) => {
  if (route.length === 0) return "Expected a non-empty rooted route"
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(route)) {
    return "A route cannot contain a URL scheme"
  }
  if (!route.startsWith("/") || route.startsWith("//")) {
    return "Expected a rooted path, not a relative path or host"
  }
  if (route.includes("#")) return "A route cannot contain a fragment"
  if (route.includes("\\")) return "A route cannot contain a backslash"
  if ([...route].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x20 || code >= 0x7f
  })) {
    return "A route must contain printable ASCII or canonical percent escapes"
  }

  const queryIndex = route.indexOf("?")
  const pathname = queryIndex === -1 ? route : route.slice(0, queryIndex)
  const query = queryIndex === -1 ? undefined : route.slice(queryIndex + 1)
  if (query !== undefined) {
    const queryFailure = routeQueryFailure(query)
    if (queryFailure !== undefined) return queryFailure
  }
  return routePathnameFailure(pathname)
}

const rootedRouteFilter = Schema.makeFilter<string>((route) =>
  routeFailure(route)
)

export const RootedRoute = Schema.String.check(rootedRouteFilter).pipe(
  Schema.brand("RootedRoute")
)
export type RootedRoute = typeof RootedRoute.Type

const webUrlFailure = (url: string) => {
  const match = /^(https?):\/\/([^/?#]+)(?:[/?#].*)?$/.exec(url)
  const scheme = match?.[1]
  const authority = match?.[2]
  if (scheme === undefined || authority === undefined) {
    return "Expected an HTTP or HTTPS URL"
  }
  if (authority.includes("@")) return "A web URL cannot contain credentials"

  const authorityMatch = /^([^:]+)(?::([0-9]+))?$/.exec(authority)
  const hostname = authorityMatch?.[1]
  const port = authorityMatch?.[2]
  if (hostname === undefined) return "A web URL must use a DNS hostname"
  return publicDnsHostnameFailure(hostname, "A web URL") ??
    canonicalHttpPortFailure(scheme, port, "A web URL")
}

const logicalHttpUrlFilter = Schema.makeFilter<HttpUrl>((url) =>
  webUrlFailure(url)
)

const LogicalHttpUrl = HttpUrl.check(logicalHttpUrlFilter)

export const ApplicationRouteRepresentation = Schema.TaggedStruct(
  "applicationRoute",
  {
    applicationId: ApplicationId,
    route: RootedRoute,
    state: Schema.optionalKey(Schema.Json)
  }
)
export type ApplicationRouteRepresentation =
  typeof ApplicationRouteRepresentation.Type

export const WebUrlRepresentation = Schema.TaggedStruct("webUrl", {
  url: LogicalHttpUrl
})
export type WebUrlRepresentation = typeof WebUrlRepresentation.Type

export const LiveRepresentation = Schema.Union([
  ApplicationRouteRepresentation,
  WebUrlRepresentation
])
export type LiveRepresentation = typeof LiveRepresentation.Type

export const ArtifactRepresentation = Schema.TaggedStruct("artifact", {
  artifactId: ArtifactId,
  digest: Sha256Digest
})
export type ArtifactRepresentation = typeof ArtifactRepresentation.Type

export const RepresentationRef = Schema.Union([
  ApplicationRouteRepresentation,
  WebUrlRepresentation,
  ArtifactRepresentation
])
export type RepresentationRef = typeof RepresentationRef.Type

export const decodeRepresentationRef = (input: Schema.Json): RepresentationRef =>
  Schema.decodeUnknownSync(
    RepresentationRef,
    { onExcessProperty: "error" }
  )(input)
