import { describe, expect, it } from "vitest"

const loadStagingModule = () => import(
  new URL("../scripts/stage-hosted-assets.mjs", import.meta.url).href
)

describe("hosted asset staging", () => {
  it("rejects a Vite source shell", async() => {
    const { assertBuiltShell } = await loadStagingModule()

    expect(() => assertBuiltShell(
      '<script type="module" src="/src/main.tsx"></script>'
    )).toThrow("/src/")
  })

  it("accepts a hashed Vite module script", async() => {
    const { assertBuiltShell } = await loadStagingModule()

    expect(() => assertBuiltShell(
      '<script type="module" src="/assets/index-a1b2c3d4.js"></script>'
    )).not.toThrow()
  })
})

