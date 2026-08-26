import { describe, expect, it } from "vitest"
import { Schema } from "effect"

import {
  AgentId,
  ApplicationId,
  ArtifactId,
  AuthSubject,
  CanvasId,
  ChangeId,
  DeploymentId,
  ExecutionId,
  FrameId,
  HttpUrl,
  Id,
  InstallationId,
  IsoTimestamp,
  PersonId,
  Sha256Digest,
  WorkspaceId
} from "../src/index.js"

const semanticIds = [
  { name: "InstallationId", valid: "installation_acme", parse: Id.installation, roundTrip: () => Schema.encodeSync(InstallationId)(Id.installation("installation_acme")) },
  { name: "WorkspaceId", valid: "workspace_storefront", parse: Id.workspace, roundTrip: () => Schema.encodeSync(WorkspaceId)(Id.workspace("workspace_storefront")) },
  { name: "CanvasId", valid: "canvas_checkout", parse: Id.canvas, roundTrip: () => Schema.encodeSync(CanvasId)(Id.canvas("canvas_checkout")) },
  { name: "FrameId", valid: "frame_mobile", parse: Id.frame, roundTrip: () => Schema.encodeSync(FrameId)(Id.frame("frame_mobile")) },
  { name: "PersonId", valid: "person_will", parse: Id.person, roundTrip: () => Schema.encodeSync(PersonId)(Id.person("person_will")) },
  { name: "AgentId", valid: "agent_codex", parse: Id.agent, roundTrip: () => Schema.encodeSync(AgentId)(Id.agent("agent_codex")) },
  { name: "ApplicationId", valid: "application_storefront", parse: Id.application, roundTrip: () => Schema.encodeSync(ApplicationId)(Id.application("application_storefront")) },
  { name: "DeploymentId", valid: "deployment_review", parse: Id.deployment, roundTrip: () => Schema.encodeSync(DeploymentId)(Id.deployment("deployment_review")) },
  { name: "ArtifactId", valid: "artifact_capture", parse: Id.artifact, roundTrip: () => Schema.encodeSync(ArtifactId)(Id.artifact("artifact_capture")) },
  { name: "ChangeId", valid: "change_01KABC", parse: Id.change, roundTrip: () => Schema.encodeSync(ChangeId)(Id.change("change_01KABC")) },
  { name: "ExecutionId", valid: "execution_01KABC", parse: Id.execution, roundTrip: () => Schema.encodeSync(ExecutionId)(Id.execution("execution_01KABC")) }
]

describe("semantic IDs", () => {
  it.each(semanticIds)("round-trips $name", ({ valid, roundTrip }) => {
    expect(roundTrip()).toBe(valid)
  })

  it.each(semanticIds)("rejects malformed $name values", ({ parse, valid }) => {
    expect(() => parse(valid.replace("_", "-"))).toThrow()
    expect(() => parse(`${valid} space`)).toThrow()
    expect(() => parse(42)).toThrow()
  })
})

describe("validated semantic strings", () => {
  it("accepts and round-trips valid values", () => {
    const url = Schema.decodeUnknownSync(HttpUrl)("https://preview.acme.test/checkout?q=1")
    const digest = Schema.decodeUnknownSync(Sha256Digest)(`sha256:${"a".repeat(64)}`)
    const timestamp = Schema.decodeUnknownSync(IsoTimestamp)("2026-08-21T12:34:56.789Z")
    const subject = Schema.decodeUnknownSync(AuthSubject)("oidc|00u123")

    expect(Schema.encodeSync(HttpUrl)(url)).toBe("https://preview.acme.test/checkout?q=1")
    expect(Schema.encodeSync(Sha256Digest)(digest)).toBe(`sha256:${"a".repeat(64)}`)
    expect(Schema.encodeSync(IsoTimestamp)(timestamp)).toBe("2026-08-21T12:34:56.789Z")
    expect(Schema.encodeSync(AuthSubject)(subject)).toBe("oidc|00u123")
  })

  it.each([
    [HttpUrl, "ftp://preview.acme.test"],
    [HttpUrl, "https://"],
    [Sha256Digest, `sha256:${"A".repeat(64)}`],
    [Sha256Digest, "abc123"],
    [IsoTimestamp, "2026-02-31T12:34:56.789Z"],
    [IsoTimestamp, "2026-08-21T12:34:56Z"],
    [AuthSubject, ""],
    [AuthSubject, " subject "],
    [AuthSubject, "two subjects"]
  ])("rejects malformed values", (schema, input) => {
    expect(() => Schema.decodeUnknownSync(schema)(input)).toThrow()
  })
})
