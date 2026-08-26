import { env } from "cloudflare:test"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { runArtifactStoreConformance } from "@crit/representations/testing"

import { R2ArtifactStore } from "../src/r2-artifact-store.js"

describe("R2 ArtifactStore", () => {
  it("satisfies ArtifactStore conformance", async () => {
    await expect(Effect.runPromise(
      runArtifactStoreConformance(R2ArtifactStore.layer(env.ARTIFACTS))
    )).resolves.toBeUndefined()
  })
})
