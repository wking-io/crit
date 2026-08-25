import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Option } from "effect"
import { afterEach, describe, expect, it } from "vitest"

import { resolveProvisionalEmail } from "../src/git-email.js"

const directories: Array<string> = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const isolatedRepo = (email: string) => {
  const root = mkdtempSync(join(tmpdir(), "crit-git-email-"))
  directories.push(root)
  execFileSync("git", ["init"], { cwd: root, env: isolatedGitEnv() })
  execFileSync("git", ["config", "user.email", email], { cwd: root, env: isolatedGitEnv() })
  return root
}

const isolatedGitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1"
})

describe("resolveProvisionalEmail", () => {
  it("decodes a local git user.email", async () => {
    const root = isolatedRepo("Will@example.com")
    const resolved = await resolveProvisionalEmail(root)
    expect(Option.getOrUndefined(resolved)).toBe("Will@example.com")
  })

  it("returns none for blank or invalid git email", async () => {
    expect(Option.isNone(await resolveProvisionalEmail(isolatedRepo("   ")))).toBe(true)
    expect(Option.isNone(await resolveProvisionalEmail(isolatedRepo("not-an-email")))).toBe(true)
  })

  it("returns none when git cannot run", async () => {
    expect(Option.isNone(await resolveProvisionalEmail(join(tmpdir(), "crit-git-email-missing")))).toBe(true)
  })
})
