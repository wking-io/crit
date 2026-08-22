import { Schema } from "effect"

import { NormalizedPoint } from "./geometry.js"
import { ChangeId, FrameId } from "./ids.js"

const nonBlank = Schema.Trimmed.check(Schema.isNonEmpty())
const LowerTagName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/))
const EvidenceKind = Schema.Literals(["id", "test-id", "aria-label", "text"])

export const ElementEvidence = Schema.Struct({ kind: EvidenceKind, value: nonBlank })
export type ElementEvidence = typeof ElementEvidence.Type

const ElementFingerprintFields = Schema.Struct({
  tagName: LowerTagName,
  evidence: Schema.Array(ElementEvidence)
})
export const ElementFingerprint = ElementFingerprintFields.check(
  Schema.makeFilter<typeof ElementFingerprintFields.Type>(({ evidence }) => {
    const keys = evidence.map(({ kind, value }) => `${kind}:${value}`)
    return evidence.length === 0 || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)
      ? "Element evidence must be non-empty, sorted, and unique"
      : undefined
  })
)
export type ElementFingerprint = typeof ElementFingerprint.Type

export const ElementAnchor = Schema.TaggedStruct("element", {
  frameId: FrameId,
  representationChangedByChangeId: ChangeId,
  selector: nonBlank,
  fingerprint: ElementFingerprint,
  fallback: NormalizedPoint
})

export const FrameAnchor = Schema.TaggedStruct("frame", {
  frameId: FrameId,
  point: NormalizedPoint
})

export const CommentAnchor = Schema.Union([FrameAnchor, ElementAnchor])
export type CommentAnchor = typeof CommentAnchor.Type
