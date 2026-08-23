import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  FRAME_INPUT_BRIDGE_SOURCE,
  FrameInputBridgeMessageSchema
} from "../src/index.js"

const fixture = async (name: string) =>
  JSON.parse(await readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", name),
    "utf8"
  ))

describe("Frame input bridge protocol", () => {
  it("round-trips the versioned fixture", async () => {
    const decoded = Schema.decodeUnknownSync(FrameInputBridgeMessageSchema)(
      await fixture("frame-input-bridge.json")
    )
    expect(decoded.source).toBe(FRAME_INPUT_BRIDGE_SOURCE)
    expect(decoded.schemaVersion).toBe(1)
    expect(decoded.intent.type).toBe("wheel")
    expect(Schema.encodeSync(FrameInputBridgeMessageSchema)(decoded)).toEqual(
      await fixture("frame-input-bridge.json")
    )
  })

  it("rejects another schema version", () => {
    expect(() => Schema.decodeUnknownSync(FrameInputBridgeMessageSchema)({
      source: FRAME_INPUT_BRIDGE_SOURCE,
      schemaVersion: 2,
      intent: { type: "delete" }
    })).toThrow()
  })
})
