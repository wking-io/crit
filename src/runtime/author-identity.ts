import { Context, Effect, Schema } from "effect"

import type { Author } from "../core/index.js"

export const GIT_AUTHOR_REMEDIATION_PROMPT = [
  "Use the crit-identity skill to verify my Git author identity for this repository.",
  "Check the effective Git user.name and user.email values.",
  "If either value is missing or invalid, ask me for the correct value, configure it for this repository only, and then run `npx @riff-refine/crit identity --json` to verify it.",
  "Do not guess or infer my identity, and do not modify global Git configuration."
].join(" ")

export class AuthorIdentityFailed extends Schema.TaggedError<AuthorIdentityFailed>()(
  "AuthorIdentityFailed",
  {
    reason: Schema.Union([
      Schema.Literal("git-unavailable"),
      Schema.Literal("missing-name"),
      Schema.Literal("missing-email"),
      Schema.Literal("invalid-name"),
      Schema.Literal("invalid-email")
    ]),
    detail: Schema.String,
    remediationPrompt: Schema.String
  }
) {}

export interface AuthorIdentityShape {
  readonly resolve: (
    root: string
  ) => Effect.Effect<Author, AuthorIdentityFailed>
}

export class AuthorIdentity extends Context.Service<
  AuthorIdentity,
  AuthorIdentityShape
>()("@riff-refine/crit/AuthorIdentity") {}
