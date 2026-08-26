import {
  ApplicationId,
  Deployment,
  DeploymentChannel,
  DeploymentId,
  DeploymentUrl,
  Id,
  IsoTimestamp,
  SourceRevision
} from "@crit/domain"
import {
  encodeDeploymentRegisteredWire,
  type RegisterDeploymentWire
} from "@crit/protocol"
import { Schema } from "effect"

const createDeploymentTableSql = `
CREATE TABLE IF NOT EXISTS deployments (
  application_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  url TEXT NOT NULL,
  source_revision TEXT,
  expires_at TEXT,
  PRIMARY KEY (application_id, channel)
) STRICT;
`

export const DeploymentRow = Schema.Struct({
  deploymentId: DeploymentId,
  applicationId: ApplicationId,
  channel: DeploymentChannel,
  url: DeploymentUrl,
  sourceRevision: Schema.NullOr(SourceRevision),
  expiresAt: Schema.NullOr(IsoTimestamp)
})
export type DeploymentRow = typeof DeploymentRow.Type

interface DeploymentDetails {
  sourceRevision?: SourceRevision
  expiresAt?: IsoTimestamp
}

const deploymentSelectSql = `
  SELECT
    deployment_id AS deploymentId,
    application_id AS applicationId,
    channel,
    url,
    source_revision AS sourceRevision,
    expires_at AS expiresAt
  FROM deployments
`

const optionalDeploymentDetails = (row: DeploymentRow): DeploymentDetails => {
  const details: DeploymentDetails = {}
  if (row.sourceRevision !== null) {
    details.sourceRevision = row.sourceRevision
  }
  if (row.expiresAt !== null) {
    details.expiresAt = row.expiresAt
  }
  return details
}

const deploymentFromRow = (row: DeploymentRow) => Deployment.make({
  deploymentId: row.deploymentId,
  applicationId: row.applicationId,
  channel: row.channel,
  url: row.url,
  ...optionalDeploymentDetails(row)
})

export const ensureDeploymentTable = async(env: Cloudflare.Env) => {
  await env.CONTROL.prepare(createDeploymentTableSql).run()
}

export const registerControlDeployment = async(
  registration: RegisterDeploymentWire,
  env: Cloudflare.Env
) => {
  await ensureDeploymentTable(env)
  const deploymentId = Id.deployment(
    `deployment_${crypto.randomUUID().replaceAll("-", "")}`
  )
  const result = await env.CONTROL.prepare(`
    INSERT INTO deployments (
      application_id,
      channel,
      deployment_id,
      url,
      source_revision,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (application_id, channel) DO UPDATE SET
      url = excluded.url,
      source_revision = excluded.source_revision,
      expires_at = excluded.expires_at
    RETURNING
      deployment_id AS deploymentId,
      application_id AS applicationId,
      channel,
      url,
      source_revision AS sourceRevision,
      expires_at AS expiresAt
  `).bind(
    registration.applicationId,
    registration.channel,
    deploymentId,
    registration.url,
    registration.sourceRevision ?? null,
    registration.expiresAt ?? null
  ).first()
  const row = Schema.decodeUnknownSync(DeploymentRow)(result)
  return encodeDeploymentRegisteredWire({
    kind: "deployment-registered",
    schemaVersion: 1,
    deploymentId: row.deploymentId,
    applicationId: row.applicationId,
    channel: row.channel,
    url: row.url,
    ...optionalDeploymentDetails(row)
  })
}

export const listControlDeployments = async(
  env: Cloudflare.Env
): Promise<readonly Deployment[]> => {
  await ensureDeploymentTable(env)
  const result = await env.CONTROL.prepare(deploymentSelectSql).all()
  return Schema.decodeUnknownSync(Schema.Array(DeploymentRow))(result.results)
    .map(deploymentFromRow)
}
