import { Effect, Layer } from "effect"

import { AuthorIdentity } from "../../src/runtime/author-identity.js"

export const TEST_AUTHOR = {
  id: "git:test",
  name: "Test Author"
} as const

export const TestAuthorIdentityLayer = Layer.succeed(AuthorIdentity, {
  resolve: () => Effect.succeed(TEST_AUTHOR)
})
