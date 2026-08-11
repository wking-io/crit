import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

import type { Author } from "../core/index.js"

const execFileAsync = promisify(execFile)

const gitConfig = async (root: string, key: "user.name" | "user.email") => {
  const result = await execFileAsync("git", ["config", "--get", key], {
    cwd: root,
    encoding: "utf8"
  })
  const value = result.stdout.trim()
  if (value.length === 0) throw new Error(`Git ${key} is not configured`)
  return value
}

export const gitAuthor = async (root: string): Promise<Author> => {
  const [name, email] = await Promise.all([
    gitConfig(root, "user.name"),
    gitConfig(root, "user.email")
  ])
  const id = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
  return { id: `git:${id}`, name }
}
