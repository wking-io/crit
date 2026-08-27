import { readFileSync } from "node:fs"
import path from "node:path"

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
    expect(description).toContain("route reporting")
    expect(description).toContain("official adapter")
    expect(description).toContain("production stays unmarked")
    expect(description).toContain("frame-ancestors")
    expect(description).toContain("allow_iframe")
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(frameBridgeSkillSource.split("\n").length).toBeLessThan(500)

    expect(frameBridgeSkillSource).toContain("@crit/frame-bridge/html")
    expect(frameBridgeSkillSource).toContain("parseFrameBridgeParentOrigin")
    expect(frameBridgeSkillSource).toContain("renderFrameRouteBridgeTag")
    expect(frameBridgeSkillSource).toContain("@crit/frame-bridge/vite")
    expect(frameBridgeSkillSource).toContain("frameRouteBridgeVitePlugin")
    expect(frameBridgeSkillSource).toContain("frameAncestorsPreviewVitePlugin")
    expect(frameBridgeSkillSource).toContain("@crit/frame-bridge/headers")
    expect(frameBridgeSkillSource).toContain("renderFrameAncestorsResponseHeaders")
    expect(frameBridgeSkillSource).toContain("renderCloudflarePagesHeadersFile")
    expect(frameBridgeSkillSource).toContain("frameAncestorsNamesOrigin")
    expect(frameBridgeSkillSource).toContain(
      "loadEnv(mode, process.cwd(), \"CRIT_\")"
    )
    expect(frameBridgeSkillSource).toContain("wantsBridge")
    expect(frameBridgeSkillSource).toContain("crit-review-preview")
    expect(frameBridgeSkillSource).toContain("CRIT_PARENT_ORIGIN")
    expect(frameBridgeSkillSource).toContain("data-crit-route-bridge")
    expect(frameBridgeSkillSource).toContain("frame-ancestors")
    expect(frameBridgeSkillSource).toContain("allow_iframe")
    expect(frameBridgeSkillSource).toContain("same_site_cookie_attribute")
    expect(frameBridgeSkillSource).toContain("all_preview_workers")
    expect(frameBridgeSkillSource).toContain("CLOUDFLARE_API_TOKEN")
    expect(frameBridgeSkillSource).toContain("dash.cloudflare.com")
    expect(frameBridgeSkillSource).not.toContain("@riff-refine/crit")
    expect(frameBridgeSkillSource).not.toContain("input bridge")
    expect(frameBridgeSkillSource).not.toContain("comment bridge")
    expect(frameBridgeSkillSource).not.toContain("frameCommentBridge")
    expect(frameBridgeSkillSource).not.toContain("enabled:")
  })

  it("matches the shipped install-crit-frame-bridge skill", () => {
    const shipped = readFileSync(
      path.join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "skills",
        "install-crit-frame-bridge",
        "SKILL.md"
      ),
      "utf8"
    )
    expect(shipped).toBe(frameBridgeSkillSource)
  })
})
