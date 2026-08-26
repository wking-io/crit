import { describe, expect, it } from "vitest"

import { frameBridgeSkillSource } from "../src/frame-bridge-skill.js"

const frontmatter = () => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(frameBridgeSkillSource)
  const header = match?.[1]
  expect(header).toEqual(expect.any(String))
  return header ?? ""
}

describe("Frame Bridge skill", () => {
  it("installs the official HTML renderer with an optional Vite leaf", () => {
    const header = frontmatter()
    const description = /^description: (.+)$/m.exec(header)?.[1] ?? ""
    expect(header).toMatch(/^name: install-crit-frame-bridge$/m)
    expect(header).not.toContain("disable-model-invocation")
    expect(description).toContain("@crit/frame-bridge")
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(frameBridgeSkillSource.split("\n").length).toBeLessThan(500)

    expect(frameBridgeSkillSource).toContain("@crit/frame-bridge/html")
    expect(frameBridgeSkillSource).toContain("renderFrameInputBridgeTag")
    expect(frameBridgeSkillSource).toContain("@crit/frame-bridge/vite")
    expect(frameBridgeSkillSource).toContain("frameInputBridgeVitePlugin")
    expect(frameBridgeSkillSource).toContain(
      "loadEnv(mode, process.cwd(), \"CRIT_\")"
    )
    expect(frameBridgeSkillSource).toContain("crit-review-preview")
    expect(frameBridgeSkillSource).toContain("CRIT_PARENT_ORIGIN")
    expect(frameBridgeSkillSource).toContain("data-crit-frame-input-bridge")
    expect(frameBridgeSkillSource).not.toContain("@riff-refine/crit")
    expect(frameBridgeSkillSource).not.toContain("frameCommentBridge")
    expect(frameBridgeSkillSource).not.toContain("enabled:")
  })
})
