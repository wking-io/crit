import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"

import { GitAuthorIdentity } from "../../src/node/git-author.js"
import {
  AuthorIdentityFailed,
  GIT_AUTHOR_REMEDIATION_PROMPT
} from "../../src/runtime/author-identity.js"

const execFileAsync = promisify(execFile)

describe("GitAuthorIdentity", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-git-author-"))
    await execFileAsync("git", ["init"], { cwd: root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("resolves a stable opaque Author from repository Git configuration", async () => {
    await execFileAsync("git", ["config", "user.name", "Willa King"], { cwd: root })
    await execFileAsync("git", ["config", "user.email", "Willa@example.com"], { cwd: root })

    const first = await Effect.runPromise(GitAuthorIdentity.make().resolve(root))
    await execFileAsync("git", ["config", "user.email", "willa@EXAMPLE.com"], { cwd: root })
    const second = await Effect.runPromise(GitAuthorIdentity.make().resolve(root))

    expect(first.name).toBe("Willa King")
    expect(first.email).toBe("Willa@example.com")
    expect(first.handle).toBe("Willa King")
    expect(first.id).toMatch(/^git:[a-f0-9]{64}$/)
    expect(second.id).toBe(first.id)
    expect(second.email).toBe("willa@EXAMPLE.com")
  })

  it("returns copy-ready remediation for missing or invalid identity", async () => {
    await execFileAsync("git", ["config", "user.name", ""], { cwd: root })
    await execFileAsync("git", ["config", "user.email", "not-an-email"], { cwd: root })

    const failure = await Effect.runPromise(
      Effect.flip(GitAuthorIdentity.make().resolve(root))
    )

    expect(failure).toBeInstanceOf(AuthorIdentityFailed)
    expect(failure).toMatchObject({
      reason: "missing-name",
      remediationPrompt: GIT_AUTHOR_REMEDIATION_PROMPT
    })
  })
})
