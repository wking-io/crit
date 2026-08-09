import { readFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"

import { CanvasCommandSchema } from "../../src/core/index.js"
import { CritManifest } from "../../src/discovery/index.js"

const readJson = async (file: string) =>
  JSON.parse(await readFile(path.resolve(file), "utf8")) as unknown

describe("Crit feature lab", () => {
  it("uses the real manifest and semantic command schemas", async () => {
    const packageJson = await readJson("package.json") as {
      readonly scripts?: Record<string, string>
      readonly portless?: { readonly name?: string; readonly script?: string }
    }
    const manifest = await Effect.runPromise(
      CritManifest.decode(
        await readJson("playground/crit.manifest.json"),
        "playground/crit.manifest.json"
      )
    )
    const commands = Schema.decodeUnknownSync(Schema.Array(CanvasCommandSchema))(
      await readJson("playground/feature-lab.commands.json")
    )
    const canvas = manifest.canvases[0]!

    expect(packageJson.scripts?.["dev:portless"]).toMatch(/(?:^|\s)portless(?:\s|$)/)
    expect(packageJson.portless).toEqual({ name: "crit", script: "dev" })
    expect(canvas.id).toBe("feature-lab")
    expect(canvas.frames.map((frame) => frame.id)).toEqual([
      "checkout-draft",
      "checkout-ready",
      "checkout-approved",
      "checkout-changes"
    ])
    expect(canvas.frames.every((frame) => frame.url.startsWith("/frames/"))).toBe(true)
    expect(canvas.frames.every((frame) => frame.status === undefined)).toBe(true)
    expect(canvas.frames.every((frame) => frame.geometry === undefined)).toBe(true)

    expect(
      commands
        .filter((command) => command._tag === "SetFrameStatus")
        .map((command) => command.status)
    ).toEqual([
      "in-progress",
      "ready-for-review",
      "approved",
      "changes-requested"
    ])
    expect(commands.filter((command) => command._tag === "AddNote")).toHaveLength(4)
    expect(commands).toContainEqual({
      _tag: "AttachNote",
      id: "attached-feedback",
      frameId: "checkout-ready"
    })
  })
})
