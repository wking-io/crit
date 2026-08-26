import { describe, expect, it } from "vitest"

import { registerDeploymentSkillSource } from "../src/register-deployment-skill.js"

const frontmatter = () => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(registerDeploymentSkillSource)
  const header = match?.[1]
  expect(header).toEqual(expect.any(String))
  return header ?? ""
}

describe("register-deployment skill", () => {
  it("is a model-invoked skill that edits GitHub Actions after a preview deploy", () => {
    const header = frontmatter()
    const description = /^description: (.+)$/m.exec(header)?.[1] ?? ""
    expect(header).toMatch(/^name: crit-register-deployment$/m)
    expect(header).not.toContain("disable-model-invocation")
    expect(description.startsWith("Register Crit preview Deployments")).toBe(true)
    expect(description).toContain("GitHub Actions")
    expect(description).toContain("crit register-deployment")
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(registerDeploymentSkillSource.split("\n").length).toBeLessThan(500)

    expect(registerDeploymentSkillSource).toContain("crit.manifest.json")
    expect(registerDeploymentSkillSource).toContain("crit register-deployment --help")
    expect(registerDeploymentSkillSource).toContain("CRIT_INSTALLATION_URL")
    expect(registerDeploymentSkillSource).toContain("CRIT_DEPLOY_TOKEN")
    expect(registerDeploymentSkillSource).toContain("${PREVIEW_URL%/}/")
    expect(registerDeploymentSkillSource).toContain("machine secret")
  })
})
