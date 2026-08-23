import { readFile } from "node:fs/promises"

import {
  CritProjectManifestV2,
  decodeCritProjectManifestV2,
  encodeCritProjectManifestV2
} from "../src/index.js"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const fixture = new URL("./fixtures/manifest-v2.json", import.meta.url)

describe("CritProjectManifestV2", () => {
  it("round-trips the versioned fixture", async() => {
    const input: unknown = JSON.parse(await readFile(fixture, "utf8"))
    const decoded = decodeCritProjectManifestV2(input)
    expect(Schema.encodeSync(CritProjectManifestV2)(decoded)).toEqual(input)
    expect(encodeCritProjectManifestV2(decoded)).toEqual(input)
  })

  it.each([
    ["legacy version", { schemaVersion: 1, applicationId: "application_storefront" }],
    ["missing application ID", { schemaVersion: 2 }],
    ["unbranded application ID", { schemaVersion: 2, applicationId: "storefront" }],
    ["excess property", { schemaVersion: 2, applicationId: "application_storefront", extra: true }],
    ["null", null],
    ["string", "manifest"]
  ] as const)("rejects an invalid persisted value: %s", (_label, input) => {
    expect(() => decodeCritProjectManifestV2(input)).toThrow()
  })
})
