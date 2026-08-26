import { readFileSync } from "node:fs"

import { CanvasEngine, Id, decodeCanvasProjection } from "@crit/domain"
import { Result } from "effect"
import { assert, describe, expect, it } from "vitest"

import { ChangeProtocol, ChangeValue, ProtocolValue } from "../src/index.js"

const fixture = (name: string) => JSON.parse(
  readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8")
)

describe("ChangeProtocol", () => {
  const valid = [
    ["proposed", "proposed"], ["accepted", "accepted"], ["accepted-agent", "accepted"], ["page", "page"],
    ["receipt-first", "receipt"], ["receipt-retry", "receipt"],
    ["failure-malformed", "failure"], ["failure-kind", "failure"],
    ["failure-version", "failure"], ["failure-trusted", "failure"]
  ] as const

  it.each(valid)("round trips %s", (name, codecName) => {
    const codec = ChangeProtocol[codecName]
    const result = codec.decode(fixture(name))
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      const encoded = codec.encode(result.success)
      expect(encoded).toEqual(fixture(name))
      expect(Result.isSuccess(codec.decode(encoded))).toBe(true)
    }
  })

  it("preserves complete nested accepted changes", () => {
    const page = ChangeProtocol.page.decode(fixture("page"))
    expect(Result.isSuccess(page) && page.success.changes[0]).toMatchObject({
      changeId: "change_a", sequence: 1, cursor: "cursor_a", acceptedAt: "2026-08-21T12:00:00.000Z"
    })
    for (const name of ["receipt-first", "receipt-retry"]) {
      const receipt = ChangeProtocol.receipt.decode(fixture(name))
      expect(Result.isSuccess(receipt) && receipt.success.change.attribution._tag).toBe("person")
    }
    const rawPage = fixture("page")
    expect(Result.isSuccess(ChangeProtocol.accepted.decode(rawPage.changes[0]))).toBe(true)
    for (const name of ["receipt-first", "receipt-retry"]) {
      expect(Result.isSuccess(ChangeProtocol.accepted.decode(fixture(name).change))).toBe(true)
    }
  })

  it("classifies headers before bodies and never throws", () => {
    const cases = [
      [{}, "malformedMessage"],
      [{ kind: "other", schemaVersion: 99 }, "messageKindMismatch"],
      [{ kind: "proposed-canvas-change", schemaVersion: 99, attribution: {} }, "unsupportedVersion"],
      [{ ...fixture("proposed"), attribution: {} }, "trustedField"],
      [{ ...fixture("proposed"), commands: [{ ...fixture("proposed").commands[0], sequence: 1 }] }, "trustedField"],
      [{ ...fixture("proposed"), commands: [{ _tag: "deleteCanvas" }] }, "messageKindMismatch"],
      [{ ...fixture("proposed"), changeId: "bad" }, "malformedMessage"]
    ] as const
    for (const [input, tag] of cases) {
      expect(() => ChangeProtocol.proposed.decode(input)).not.toThrow()
      const result = ChangeProtocol.proposed.decode(input)
      expect(Result.isFailure(result) && result.failure._tag).toBe(tag)
    }
  })

  it("classifies every authority identity and runtime field at either proposal boundary", () => {
    const fields = [
      "subject", "actor", "author", "person", "agent", "editedAt", "at", "time",
      "digest", "hash", "acceptedAt", "attribution", "sequence", "cursor",
      "personId", "agentId", "executionId", "delegatedBy", "email", "address",
      "reportedRuntime", "harness", "model", "source", "sessionId", "taskId", "displayName"
    ]
    for (const field of fields) {
      const root = ChangeProtocol.proposed.decode({ ...fixture("proposed"), [field]: "forged" })
      expect(Result.isFailure(root) && root.failure).toMatchObject({ _tag: "trustedField", location: "message" })
      const proposed = fixture("proposed")
      proposed.commands[0][field] = "forged"
      const command = ChangeProtocol.proposed.decode(proposed)
      expect(Result.isFailure(command) && command.failure).toMatchObject({ _tag: "trustedField", location: "command" })
    }
  })

  it("rejects invalid sequence, cursor, empty commands, and nested wire shortcuts", () => {
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(Result.isFailure(ChangeProtocol.accepted.decode({ ...fixture("accepted"), sequence }))).toBe(true)
    }
    expect(() => ProtocolValue.cursor("opaque")).toThrow()
    expect(() => ProtocolValue.sequence(0)).toThrow()
    expect(Result.isFailure(ChangeProtocol.proposed.decode({ ...fixture("proposed"), commands: [] }))).toBe(true)
    const page = fixture("page")
    page.changes[0] = { changeId: "change_a" }
    expect(Result.isFailure(ChangeProtocol.page.decode(page))).toBe(true)
    expect(Result.isFailure(ChangeProtocol.page.decode({ ...fixture("page"), cursor: null }))).toBe(true)
    const wrongNestedVersion = fixture("page")
    wrongNestedVersion.changes[0].schemaVersion = 1
    const versionResult = ChangeProtocol.page.decode(wrongNestedVersion)
    expect(Result.isFailure(versionResult) && versionResult.failure._tag).toBe("unsupportedVersion")
    const privateReceipt = fixture("receipt-first")
    privateReceipt.digest = "authority-private"
    expect(Result.isFailure(ChangeProtocol.receipt.decode(privateReceipt))).toBe(true)
    expect(Result.isFailure(ChangeProtocol.accepted.decode({ ...fixture("accepted"), attribution: {} }))).toBe(true)
  })

  it("exposes only semantic protocol values", async () => {
    expect(Object.keys(await import("../src/index.js")).sort()).toEqual([
      "AcceptedCanvasChangeSchema", "AccessAuthenticatedPersonWire",
      "ArtifactContentCorrupt", "ArtifactDigestConflict", "ArtifactStoredWire",
      "CanvasDirectoryEntryWire", "CanvasDirectoryWire", "CanvasSharedWire",
      "ChangePageSchema", "ChangeProtocol", "ChangeValue",
      "CritProjectManifestV2", "CursorSchema", "DeploymentRegisteredWire",
      "FRAME_INPUT_BRIDGE_SCHEMA_VERSION", "FRAME_INPUT_BRIDGE_SOURCE",
      "FRAME_ROUTE_BRIDGE_SCHEMA_VERSION", "FRAME_ROUTE_BRIDGE_SOURCE",
      "FrameBridgeOrigin",
      "FrameInputBridgeMessageSchema", "FrameInputIntentSchema",
      "FrameRoute", "FrameRouteBridgeMessageSchema",
      "HostedApplicationResolveRequest", "HostedApplicationResolveResponse",
      "PresenceChangedSchema", "ProposedCanvasChangeSchema", "ProtocolValue",
      "RegisterDeploymentWire", "RemoteAuthorityRoute", "ReplicaChangedSchema",
      "SequenceSchema",
      "ShareCanvasWire", "ShareDigestMismatch", "SubmitCanvasChangeWire",
      "SubmitChangeReceiptSchema", "artifactCollectionPath",
      "decodeAccessAuthenticatedPersonWire", "decodeArtifactStoredWire",
      "decodeCanvasDirectoryWire", "decodeCanvasSharedWire",
      "decodeCritProjectManifestV2", "decodeDeploymentRegisteredWire",
      "decodeFrameInputBridgeMessage", "decodeFrameRouteBridgeMessage",
      "decodeHostedApplicationResolveRequest",
      "decodeHostedApplicationResolveResponse",
      "decodeRegisterDeploymentWire", "decodeShareCanvasWire",
      "decodeSubmitCanvasChangeWire",
      "encodeAccessAuthenticatedPersonWire", "encodeArtifactStoredWire",
      "encodeCanvasDirectoryWire", "encodeCanvasSharedWire",
      "encodeChangesAfterSearch",
      "encodeCritProjectManifestV2",
      "encodeDeploymentRegisteredWire",
      "encodeHostedApplicationResolveRequest",
      "encodeHostedApplicationResolveResponse", "encodeRegisterDeploymentWire",
      "encodeShareCanvasWire", "encodeSubmitCanvasChangeWire",
      "hostedApplicationResolvePath", "parseArtifactDigestSearch",
      "parseArtifactPath", "parseChangesAfterSearch", "parseRemoteAuthorityPath",
      "remoteArtifactPath",
      "remoteCanvasChangesPath", "remoteCanvasCollectionPath",
      "remoteCanvasPath", "remoteChangesPageLimit"
    ])
  })

  it("owns change equality and accepted-to-proposed conversion", () => {
    const proposed = ChangeProtocol.proposed.decode(fixture("proposed"))
    const accepted = ChangeProtocol.accepted.decode(fixture("accepted"))
    assert(Result.isSuccess(proposed))
    assert(Result.isSuccess(accepted))
    expect(ChangeValue.proposedEquals(proposed.success, ChangeValue.proposalOf(accepted.success))).toBe(true)
    const acceptedProposal = ChangeValue.proposalOf(accepted.success)
    expect(ChangeValue.proposedEquals(acceptedProposal, { ...acceptedProposal })).toBe(true)
    expect(ChangeValue.proposedEquals(acceptedProposal, {
      ...acceptedProposal,
      changeId: Id.change("change_different")
    })).toBe(false)
    expect(ChangeValue.acceptedEquals(accepted.success, { ...accepted.success })).toBe(true)
  })

  it("feeds decoded accepted changes directly into domain replay", () => {
    const initial = decodeCanvasProjection({
      schemaVersion: 3,
      canvasId: "canvas_a",
      title: "Old",
      frames: [],
      stack: [],
      stackChangedByChangeId: null,
      issuedIds: { frameIds: [] }
    })
    const accepted = ChangeProtocol.accepted.decode(fixture("accepted"))
    assert(Result.isSuccess(accepted))

    expect(CanvasEngine.replay(initial, [accepted.success])).toEqual({
      _tag: "replayed",
      projection: {
        schemaVersion: 3,
        canvasId: "canvas_a",
        title: "New",
        frames: [],
        stack: [],
        stackChangedByChangeId: null,
        issuedIds: { frameIds: [] }
      }
    })
  })

  it("round trips every command tag", () => {
    const g = { x: 0, y: 0, width: 100, height: 80 }
    const item = { _tag: "frame", frameId: "frame_a" }
    const representation = { _tag: "applicationRoute", applicationId: "application_a", route: "/review" }
    const commands = [
      { _tag: "renameCanvas", expectedTitle: "Old", title: "New" },
      { _tag: "addFrame", frameId: "frame_a", title: "Frame", representation, status: "in-progress", geometry: g },
      { _tag: "setFrameTitle", frameId: "frame_a", expectedChangedByChangeId: "change_a", title: "Title" },
      { _tag: "setFrameRepresentation", frameId: "frame_a", expectedChangedByChangeId: "change_a", representation },
      { _tag: "setFrameStatus", frameId: "frame_a", expectedChangedByChangeId: "change_a", status: "ready-for-review" },
      { _tag: "setFrameGeometry", frameId: "frame_a", expectedChangedByChangeId: "change_a", geometry: g },
      { _tag: "removeFrame", frameId: "frame_a", expectedUpdatedByChangeId: "change_a" },
      { _tag: "placeCanvasItem", item, after: null, expectedStackChangeId: "change_a" }
    ]
    const wire = { kind: "proposed-canvas-change", schemaVersion: 2, changeId: "change_commands", canvasId: "canvas_a", observedCursor: null, commands }
    const result = ChangeProtocol.proposed.decode(wire)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) expect(ChangeProtocol.proposed.encode(result.success)).toEqual(wire)
  })

  it("classifies v1 command-bearing messages as unsupported", () => {
    for (const name of ["proposed", "accepted", "page", "receipt-first"] as const) {
      const input = fixture(name)
      input.schemaVersion = 1
      const codec = name === "proposed" ? ChangeProtocol.proposed : name === "accepted" ? ChangeProtocol.accepted : name === "page" ? ChangeProtocol.page : ChangeProtocol.receipt
      const result = codec.decode(input)
      expect(Result.isFailure(result) && result.failure._tag).toBe("unsupportedVersion")
    }
  })

  it("does not treat application state data as authority-owned protocol fields", () => {
    const input = fixture("proposed")
    input.commands = [{
      _tag: "addFrame", frameId: "frame_a", title: "Frame", status: "in-progress",
      geometry: { x: 0, y: 0, width: 100, height: 80 },
      representation: {
        _tag: "applicationRoute", applicationId: "application_a", route: "/review",
        state: { actor: "npc", source: "checkout", nested: { displayName: "Merchant" } }
      }
    }]
    expect(Result.isSuccess(ChangeProtocol.proposed.decode(input))).toBe(true)
    input.commands[0].representation.personId = "person_forged"
    expect(ChangeProtocol.proposed.decode(input)).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "trustedField", location: "command" }
    })
  })
})
