import { Schema } from "effect"

export const ArtifactContentKind = Schema.Literals(["html-document", "opaque"])
export type ArtifactContentKind = typeof ArtifactContentKind.Type

export const artifactContentKind = (bytes: Uint8Array): ArtifactContentKind => {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1_024))
  return /^(?:<!doctype html|<html)/i.test(prefix.replace(/^\uFEFF/, "").trimStart())
    ? "html-document"
    : "opaque"
}
