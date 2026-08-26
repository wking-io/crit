import {
  AccessPersonEmail,
  CanvasId,
  CanvasTitle,
  ImportId,
  PersonId,
  PersonSnapshot,
  Sha256Digest,
  ShareId,
  WorkspaceId
} from "@crit/domain"
import { Schema } from "effect"

const AccessPersonSnapshot = Schema.TaggedStruct("person", {
  personId: PersonSnapshot.fields.personId,
  displayName: PersonSnapshot.fields.displayName,
  email: AccessPersonEmail
})

export const ShareCanvasWire = Schema.Struct({
  kind: Schema.Literal("share-canvas"),
  schemaVersion: Schema.Literal(2),
  canvasId: CanvasId,
  title: CanvasTitle,
  shareId: ShareId,
  importId: ImportId,
  projectionDigest: Sha256Digest,
  person: AccessPersonSnapshot
})
export type ShareCanvasWire = typeof ShareCanvasWire.Type

export const CanvasSharedWire = Schema.Struct({
  kind: Schema.Literal("canvas-shared"),
  schemaVersion: Schema.Literal(2),
  canvasId: CanvasId,
  title: CanvasTitle,
  shareId: ShareId,
  importId: ImportId,
  projectionDigest: Sha256Digest,
  workspaceId: WorkspaceId,
  personId: PersonId
})
export type CanvasSharedWire = typeof CanvasSharedWire.Type

export const ShareDigestMismatch = Schema.TaggedStruct("shareDigestMismatch", {
  shareId: ShareId,
  expectedDigest: Sha256Digest,
  receivedDigest: Sha256Digest
})
export type ShareDigestMismatch = typeof ShareDigestMismatch.Type

export const decodeShareCanvasWire = Schema.decodeUnknownSync(
  ShareCanvasWire,
  { onExcessProperty: "error" }
)

export const encodeShareCanvasWire = Schema.encodeSync(
  ShareCanvasWire,
  { onExcessProperty: "error" }
)

export const decodeCanvasSharedWire = Schema.decodeUnknownSync(
  CanvasSharedWire,
  { onExcessProperty: "error" }
)

export const encodeCanvasSharedWire = Schema.encodeSync(
  CanvasSharedWire,
  { onExcessProperty: "error" }
)
