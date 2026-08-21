import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { ChangeProtocol, ProtocolValue } from "../src/index.js"

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
    expect(result.ok).toBe(true)
    if (result.ok) {
      const encoded = codec.encode(result.value)
      expect(encoded).toEqual(fixture(name))
      expect(codec.decode(encoded).ok).toBe(true)
    }
  })

  it("preserves complete nested accepted changes", () => {
    const page = ChangeProtocol.page.decode(fixture("page"))
    expect(page.ok && page.value.changes[0]).toMatchObject({
      changeId: "change_a", sequence: 1, cursor: "cursor_a", acceptedAt: "2026-08-21T12:00:00.000Z"
    })
    for (const name of ["receipt-first", "receipt-retry"]) {
      const receipt = ChangeProtocol.receipt.decode(fixture(name))
      expect(receipt.ok && receipt.value.change.attribution._tag).toBe("person")
    }
    const rawPage = fixture("page")
    expect(ChangeProtocol.accepted.decode(rawPage.changes[0]).ok).toBe(true)
    for (const name of ["receipt-first", "receipt-retry"]) {
      expect(ChangeProtocol.accepted.decode(fixture(name).change).ok).toBe(true)
    }
  })

  it("classifies headers before bodies and never throws", () => {
    const cases = [
      [{}, "malformed-message"],
      [{ kind: "other", schemaVersion: 99 }, "message-kind-mismatch"],
      [{ kind: "proposed-canvas-change", schemaVersion: 99, attribution: {} }, "unsupported-version"],
      [{ ...fixture("proposed"), attribution: {} }, "trusted-field"],
      [{ ...fixture("proposed"), commands: [{ ...fixture("proposed").commands[0], sequence: 1 }] }, "trusted-field"],
      [{ ...fixture("proposed"), commands: [{ _tag: "delete-canvas" }] }, "message-kind-mismatch"],
      [{ ...fixture("proposed"), changeId: "bad" }, "malformed-message"]
    ] as const
    for (const [input, tag] of cases) {
      expect(() => ChangeProtocol.proposed.decode(input)).not.toThrow()
      const result = ChangeProtocol.proposed.decode(input)
      expect(!result.ok && result.failure._tag).toBe(tag)
    }
  })

  it("classifies every authority identity and runtime field at either proposal boundary", () => {
    const fields = [
      "subject", "actor", "author", "person", "agent", "editedAt", "at", "time",
      "digest", "hash", "acceptedAt", "attribution", "sequence", "cursor",
      "personId", "agentId", "oauthClientId", "grantId", "executionId", "delegatedBy",
      "reportedRuntime", "harness", "model", "source", "sessionId", "taskId", "displayName"
    ]
    for (const field of fields) {
      const root = ChangeProtocol.proposed.decode({ ...fixture("proposed"), [field]: "forged" })
      expect(!root.ok && root.failure).toMatchObject({ _tag: "trusted-field", location: "message" })
      const proposed = fixture("proposed")
      proposed.commands[0][field] = "forged"
      const command = ChangeProtocol.proposed.decode(proposed)
      expect(!command.ok && command.failure).toMatchObject({ _tag: "trusted-field", location: "command" })
    }
  })

  it("rejects invalid sequence, cursor, empty commands, and nested wire shortcuts", () => {
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ChangeProtocol.accepted.decode({ ...fixture("accepted"), sequence }).ok).toBe(false)
    }
    expect(() => ProtocolValue.cursor("opaque")).toThrow()
    expect(() => ProtocolValue.sequence(0)).toThrow()
    expect(ChangeProtocol.proposed.decode({ ...fixture("proposed"), commands: [] }).ok).toBe(false)
    const page = fixture("page")
    page.changes[0] = { changeId: "change_a" }
    expect(ChangeProtocol.page.decode(page).ok).toBe(false)
    expect(ChangeProtocol.page.decode({ ...fixture("page"), cursor: null }).ok).toBe(false)
    const wrongNestedVersion = fixture("page")
    wrongNestedVersion.changes[0].schemaVersion = 2
    const versionResult = ChangeProtocol.page.decode(wrongNestedVersion)
    expect(!versionResult.ok && versionResult.failure._tag).toBe("unsupported-version")
    const privateReceipt = fixture("receipt-first")
    privateReceipt.digest = "authority-private"
    expect(ChangeProtocol.receipt.decode(privateReceipt).ok).toBe(false)
    expect(ChangeProtocol.accepted.decode({ ...fixture("accepted"), attribution: {} }).ok).toBe(false)
  })

  it("exposes only semantic protocol values", async () => {
    expect(Object.keys(await import("../src/index.js")).sort()).toEqual([
      "ChangeProtocol", "ProtocolValue"
    ])
  })
})
