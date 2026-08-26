import { Id } from "@crit/domain"
import { describe, expect, it } from "vitest"

import {
  decodeArtifactStoredWire,
  encodeArtifactStoredWire,
  parseArtifactDigestSearch,
  parseArtifactPath,
  remoteArtifactPath
} from "../src/artifact.js"

describe("artifact protocol", () => {
  it("parses artifact paths", () => {
    const artifactId = Id.artifact("artifact_checkout")
    expect(parseArtifactPath(remoteArtifactPath(artifactId))).toBe(artifactId)
    expect(parseArtifactPath("/artifacts")).toBeUndefined()
    expect(parseArtifactPath("/artifacts/not-an-id")).toBeUndefined()
  })

  it("parses a digest query", () => {
    const digest = `sha256:${"a".repeat(64)}`
    expect(parseArtifactDigestSearch(`?digest=${digest}`)).toBe(digest)
    expect(parseArtifactDigestSearch("")).toBeUndefined()
  })

  it("round-trips a stored receipt", () => {
    const wire = {
      kind: "artifact-stored" as const,
      schemaVersion: 1 as const,
      artifactId: "artifact_checkout",
      digest: `sha256:${"b".repeat(64)}`
    }
    expect(decodeArtifactStoredWire(encodeArtifactStoredWire(wire))).toEqual(wire)
  })
})
