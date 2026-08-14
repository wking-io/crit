import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

import { Effect, Layer } from "effect"

import type { Author } from "../core/index.js"
import {
  AuthorIdentity,
  AuthorIdentityFailed,
  GIT_AUTHOR_REMEDIATION_PROMPT
} from "../runtime/author-identity.js"

const execFileAsync = promisify(execFile)

const missing = (reason: "missing-name" | "missing-email", detail: string) =>
  new AuthorIdentityFailed({
    reason,
    detail,
    remediationPrompt: GIT_AUTHOR_REMEDIATION_PROMPT
  })

const invalid = (reason: "invalid-name" | "invalid-email", detail: string) =>
  new AuthorIdentityFailed({
    reason,
    detail,
    remediationPrompt: GIT_AUTHOR_REMEDIATION_PROMPT
  })

const unavailable = (cause: unknown) =>
  new AuthorIdentityFailed({
    reason: "git-unavailable",
    detail:
      cause instanceof Error
        ? `Git author identity could not be read: ${cause.message}`
        : "Git author identity could not be read",
    remediationPrompt: GIT_AUTHOR_REMEDIATION_PROMPT
  })

const gitConfig = async (root: string, key: "user.name" | "user.email") => {
  try {
    const result = await execFileAsync("git", ["config", "--get", key], {
      cwd: root,
      encoding: "utf8"
    })
    return result.stdout.trim()
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === 1
    ) {
      return ""
    }
    throw cause
  }
}

const authorFrom = (nameInput: string, emailInput: string): Author => {
  const name = nameInput.trim()
  const email = emailInput.trim()
  if (name.length === 0) {
    throw missing("missing-name", "Git user.name is not configured")
  }
  if (email.length === 0) {
    throw missing("missing-email", "Git user.email is not configured")
  }
  if (/\p{Cc}/u.test(name)) {
    throw invalid("invalid-name", "Git user.name contains control characters")
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw invalid("invalid-email", "Git user.email is not a valid email address")
  }
  const id = createHash("sha256")
    .update(email.toLowerCase())
    .digest("hex")
  return { id: `git:${id}`, name }
}

const make = (): AuthorIdentity["Service"] => ({
  resolve: (root) =>
    Effect.tryPromise({
      try: async () => {
        const [name, email] = await Promise.all([
          gitConfig(root, "user.name"),
          gitConfig(root, "user.email")
        ])
        return authorFrom(name, email)
      },
      catch: (cause) =>
        cause instanceof AuthorIdentityFailed ? cause : unavailable(cause)
    })
})

const layer = Layer.succeed(AuthorIdentity, make())

export const GitAuthorIdentity = { make, layer } as const

export const gitAuthor = (root: string): Promise<Author> =>
  Effect.runPromise(make().resolve(root))
