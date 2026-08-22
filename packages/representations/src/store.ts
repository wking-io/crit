import type { ArtifactId, ArtifactRepresentation, Sha256Digest } from "@crit/domain"
import { Context, Data, type Effect } from "effect"

export interface PutArtifact {
  readonly artifactId: ArtifactId
  readonly bytes: Uint8Array
}

export class ArtifactNotFound extends Data.TaggedError("ArtifactNotFound")<{
  readonly artifact: ArtifactRepresentation
}> {}

export class ArtifactCorrupt extends Data.TaggedError("ArtifactCorrupt")<{
  readonly artifact: ArtifactRepresentation
  readonly actualDigest: Sha256Digest
}> {}

export class ArtifactConflict extends Data.TaggedError("ArtifactConflict")<{
  readonly artifactId: ArtifactId
  readonly storedDigest: Sha256Digest
  readonly suppliedDigest: Sha256Digest
}> {}

export class ArtifactStoreIoFailure extends Data.TaggedError("ArtifactStoreIoFailure")<{
  readonly artifactId: ArtifactId
  readonly operation: "put" | "read"
  readonly reason: string
}> {}

export type ArtifactStoreFailure =
  | ArtifactNotFound
  | ArtifactCorrupt
  | ArtifactConflict
  | ArtifactStoreIoFailure

export class ArtifactStore extends Context.Service<ArtifactStore, {
  readonly put: (input: PutArtifact) => Effect.Effect<ArtifactRepresentation, ArtifactConflict | ArtifactStoreIoFailure>
  readonly read: (artifact: ArtifactRepresentation) => Effect.Effect<Uint8Array, ArtifactNotFound | ArtifactCorrupt | ArtifactStoreIoFailure>
}>()("@crit/representations/ArtifactStore") {}
