import { ArtifactId, Sha256Digest } from "@crit/domain"
import { Option, Schema } from "effect"

import { queryParam } from "./query.js"

export const artifactCollectionPath = "/artifacts"

export const remoteArtifactPath = (artifactId: ArtifactId): string =>
  `${artifactCollectionPath}/${encodeURIComponent(artifactId)}`

const artifactIdFromPath = (raw: string): ArtifactId | undefined => {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(ArtifactId)(decoded))
}

export const parseArtifactPath = (pathname: string): ArtifactId | undefined => {
  const match = /^\/artifacts\/([^/]+)$/.exec(pathname)
  if (match === null) return undefined
  return artifactIdFromPath(match[1] ?? "")
}

export const parseArtifactDigestSearch = (search: string): Sha256Digest | undefined => {
  const digest = queryParam(search, "digest")
  if (digest === null) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Sha256Digest)(digest))
}

export const ArtifactStoredWire = Schema.Struct({
  kind: Schema.Literal("artifact-stored"),
  schemaVersion: Schema.Literal(1),
  artifactId: ArtifactId,
  digest: Sha256Digest
})
export type ArtifactStoredWire = typeof ArtifactStoredWire.Type

export const ArtifactDigestConflict = Schema.TaggedStruct("artifactDigestConflict", {
  artifactId: ArtifactId,
  storedDigest: Sha256Digest,
  suppliedDigest: Sha256Digest
})
export type ArtifactDigestConflict = typeof ArtifactDigestConflict.Type

export const ArtifactContentCorrupt = Schema.TaggedStruct("artifactCorrupt", {
  artifactId: ArtifactId,
  expectedDigest: Sha256Digest,
  actualDigest: Sha256Digest
})
export type ArtifactContentCorrupt = typeof ArtifactContentCorrupt.Type

export const decodeArtifactStoredWire = Schema.decodeUnknownSync(
  ArtifactStoredWire,
  { onExcessProperty: "error" }
)
export const encodeArtifactStoredWire = Schema.encodeSync(
  ArtifactStoredWire,
  { onExcessProperty: "error" }
)
