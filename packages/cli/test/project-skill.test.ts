import { describe, expect, it } from "vitest"

import { projectSkillSource } from "../src/project-skill.js"

const frontmatter = () => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(projectSkillSource)
  const header = match?.[1]
  expect(header).toEqual(expect.any(String))
  return header ?? ""
}

describe("project skill", () => {
  it("is a model-invoked Cursor skill for the full Crit product", () => {
    const header = frontmatter()
    const description = /^description: (.+)$/m.exec(header)?.[1] ?? ""
    expect(header).toMatch(/^name: crit$/m)
    expect(description.startsWith("Uses Crit ")).toBe(true)
    expect(header).not.toContain("disable-model-invocation")
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(projectSkillSource.split("\n").length).toBeLessThan(500)

    expect(header).toContain("add a Frame")
    expect(header).toContain("lay out a Canvas")
    expect(header).toContain("capture a page")
    expect(header).toContain("ready-for-review")
    expect(header).not.toContain("Note")
    expect(header).not.toContain("comment")

    expect(projectSkillSource).toContain("crit --help")
    expect(projectSkillSource).toContain("canvas_local")
    expect(projectSkillSource).toContain("application-route")
    expect(projectSkillSource).toContain("web-url")
    expect(projectSkillSource).toContain("artifact")
    expect(projectSkillSource).toContain("crit add-frame")
    expect(projectSkillSource).toContain("crit agent begin")
    expect(projectSkillSource).toContain("eval \"$(crit agent begin --name <agent-name> --harness <harness>)\"")
    expect(projectSkillSource).toContain("Frame Bridge")
    expect(projectSkillSource).toContain("install-crit-frame-bridge")
    expect(projectSkillSource).toContain("@crit/frame-bridge")
    expect(projectSkillSource).toContain("crit-register-deployment")
    expect(projectSkillSource).not.toContain("comment thread")
    expect(projectSkillSource).not.toContain("Note")
  })
})
