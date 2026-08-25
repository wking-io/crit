import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { EmailAddress } from "@crit/domain"
import { Option, Schema } from "effect"

const execFileAsync = promisify(execFile)

export const resolveProvisionalEmail = async (root: string) => {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", "user.email"], {
      cwd: root,
      encoding: "utf8",
      timeout: 2_000
    })
    return Schema.decodeUnknownOption(EmailAddress)(stdout.trim())
  } catch {
    return Option.none()
  }
}
