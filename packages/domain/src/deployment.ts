import { Result, Schema } from "effect"

import {
  ApplicationId,
  DeploymentId,
  IsoTimestamp
} from "./ids.js"
import {
  canonicalHttpPortFailure,
  publicDnsHostnameFailure
} from "./http-authority.js"
import { NonBlankString } from "./text.js"

const deploymentUrlFailure = (value: string) => {
  const match = /^(https?):\/\/([^/?#]+)(?:[/?#].*)?$/.exec(value)
  const scheme = match?.[1]
  const authority = match?.[2]
  if (scheme === undefined || authority === undefined) {
    return "Expected an HTTP or HTTPS deployment URL"
  }
  if (authority.includes("@")) {
    return "A deployment URL cannot contain credentials"
  }

  const authorityMatch = /^([^:]+)(?::([0-9]+))?$/.exec(authority)
  const hostname = authorityMatch?.[1]
  const port = authorityMatch?.[2]
  if (hostname === undefined) {
    return "A deployment URL must use a DNS hostname"
  }
  const hostnameFailure = publicDnsHostnameFailure(hostname, "A deployment URL")
  if (hostnameFailure !== undefined) return hostnameFailure
  const portFailure = canonicalHttpPortFailure(scheme, port, "A deployment URL")
  if (portFailure !== undefined) return portFailure

  const parsed = Schema.decodeUnknownResult(Schema.URLFromString)(value)
  if (Result.isFailure(parsed)) {
    return "Expected an HTTP or HTTPS deployment URL"
  }
  const url = parsed.success
  if (url.pathname !== "/") {
    return "A deployment URL must identify the authority root"
  }
  if (value.includes("?")) {
    return "A deployment URL cannot contain a query"
  }
  if (value.includes("#")) {
    return "A deployment URL cannot contain a fragment"
  }
  return url.href === value
    ? undefined
    : "A deployment URL must use its canonical form"
}

export const DeploymentChannel = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)
).pipe(Schema.brand("DeploymentChannel"))
export type DeploymentChannel = typeof DeploymentChannel.Type

export const SourceRevision = NonBlankString.pipe(
  Schema.brand("SourceRevision")
)
export type SourceRevision = typeof SourceRevision.Type

export const DeploymentUrl = Schema.String.check(
  Schema.makeFilter<string>(deploymentUrlFailure)
).pipe(Schema.brand("DeploymentUrl"))
export type DeploymentUrl = typeof DeploymentUrl.Type

export const Deployment = Schema.TaggedStruct("deployment", {
  deploymentId: DeploymentId,
  applicationId: ApplicationId,
  channel: DeploymentChannel,
  url: DeploymentUrl,
  sourceRevision: Schema.optionalKey(SourceRevision),
  expiresAt: Schema.optionalKey(IsoTimestamp)
})
export type Deployment = typeof Deployment.Type

export const decodeDeployment = (input: Schema.Json): Deployment =>
  Schema.decodeUnknownSync(
    Deployment,
    { onExcessProperty: "error" }
  )(input)
