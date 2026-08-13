import { describe, expect, it } from "vitest"

import { frameVariantFromUrl } from "../../playground/src/frame-page.js"

describe("synth Frame routes", () => {
  it.each([
    ["http://localhost:5173/synth?variant=A&preview=1", "A"],
    ["https://crit.localhost/synth?variant=b&preview=1", "B"],
    ["/synth?variant=C&preview=1", "C"]
  ] as const)("maps %s to variant %s", (url, variant) => {
    expect(frameVariantFromUrl(url)).toBe(variant)
  })

  it("does not treat unrelated playground routes as synth Frames", () => {
    expect(frameVariantFromUrl("/frames/ready")).toBeUndefined()
    expect(frameVariantFromUrl("/synth?variant=D")).toBeUndefined()
  })
})
