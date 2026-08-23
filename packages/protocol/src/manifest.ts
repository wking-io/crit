import { ApplicationId } from "@crit/domain"
import { Schema } from "effect"

export const CritProjectManifestV2 = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  applicationId: ApplicationId
})
export type CritProjectManifestV2 = typeof CritProjectManifestV2.Type

export const decodeCritProjectManifestV2 = Schema.decodeUnknownSync(
  CritProjectManifestV2,
  { onExcessProperty: "error" }
)

export const encodeCritProjectManifestV2 = Schema.encodeSync(CritProjectManifestV2)
