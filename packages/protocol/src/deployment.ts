import {
  ApplicationId,
  DeploymentChannel,
  DeploymentId,
  DeploymentUrl,
  IsoTimestamp,
  SourceRevision
} from "@crit/domain"
import { Schema } from "effect"

export const RegisterDeploymentWire = Schema.Struct({
  kind: Schema.Literal("register-deployment"),
  schemaVersion: Schema.Literal(1),
  applicationId: ApplicationId,
  channel: DeploymentChannel,
  url: DeploymentUrl,
  sourceRevision: Schema.optionalKey(SourceRevision),
  expiresAt: Schema.optionalKey(IsoTimestamp)
})
export type RegisterDeploymentWire = typeof RegisterDeploymentWire.Type

export const DeploymentRegisteredWire = Schema.Struct({
  kind: Schema.Literal("deployment-registered"),
  schemaVersion: Schema.Literal(1),
  deploymentId: DeploymentId,
  applicationId: ApplicationId,
  channel: DeploymentChannel,
  url: DeploymentUrl,
  sourceRevision: Schema.optionalKey(SourceRevision),
  expiresAt: Schema.optionalKey(IsoTimestamp)
})
export type DeploymentRegisteredWire = typeof DeploymentRegisteredWire.Type

export const decodeRegisterDeploymentWire = Schema.decodeUnknownSync(
  RegisterDeploymentWire,
  { onExcessProperty: "error" }
)

export const encodeRegisterDeploymentWire = Schema.encodeSync(
  RegisterDeploymentWire,
  { onExcessProperty: "error" }
)

export const decodeDeploymentRegisteredWire = Schema.decodeUnknownSync(
  DeploymentRegisteredWire,
  { onExcessProperty: "error" }
)

export const encodeDeploymentRegisteredWire = Schema.encodeSync(
  DeploymentRegisteredWire,
  { onExcessProperty: "error" }
)
