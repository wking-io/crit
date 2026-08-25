import { Schema } from "effect"

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
  if (query !== undefined && query.length === 0) {
    return "A route cannot contain an empty query marker"
  }
  if (query !== undefined) {
    const invalidPercent = percentFailure(query, "A route query")
    if (invalidPercent !== undefined) return invalidPercent
    try {
      decodeURIComponent(query)
    } catch {
      return "A route query must contain valid percent encoding"
    }
  }
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
  if (hostname !== hostname.toLowerCase()) {
    return "A web URL hostname must be lowercase"
  }
  if (
    hostname.length > 253 ||
    hostname.endsWith(".") ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    return "A web URL must use a canonical public DNS hostname"
  }

  const labels = hostname.split(".")
  if (labels.some((label) =>
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) {
    return "A web URL contains an invalid DNS label"
  }
  if (labels.every((label) => /^(?:[0-9]+|0x[0-9a-f]+)$/.test(label))) {
    return "A web URL cannot use an IP or alternate numeric host"
  }

  if (port !== undefined) {
    const portNumber = Number(port)
    if (
      port.startsWith("0") ||
      !Number.isSafeInteger(portNumber) ||
      portNumber < 1 ||
      portNumber > 65_535 ||
      (scheme === "http" && portNumber === 80) ||
      (scheme === "https" && portNumber === 443)
    ) {
      return "A web URL port must use a canonical non-default numeric form"
    }
  }
  return undefined
}

const logicalHttpUrlFilter = Schema.makeFilter<HttpUrl>((url) =>
  webUrlFailure(url)
)

const LogicalHttpUrl = HttpUrl.check(logicalHttpUrlFilter)

export const ApplicationRouteRepresentation = Schema.TaggedStruct(
  "application-route",
  {
    applicationId: ApplicationId,
    route: RootedRoute,
    state: Schema.optionalKey(Schema.Json)
  }
)
export type ApplicationRouteRepresentation =
  typeof ApplicationRouteRepresentation.Type

export const WebUrlRepresentation = Schema.TaggedStruct("web-url", {
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
