import { describe, expect, it } from "vitest"

import { frameIframeUrl } from "../../src/react/frame-loading.js"

describe("frameIframeUrl", () => {
  const frame = {
    id: "candidate",
    url: "https://portal.example/frames/ready?variant=2#section"
  }

  it("uses the canonical URL for direct navigation", () => {
    expect(frameIframeUrl("review", frame, { strategy: "navigate" }))
      .toBe(frame.url)
  })

  it("uses a stable real navigation URL for relayed live Frames", () => {
    expect(frameIframeUrl("review space", frame, { strategy: "relay" }))
      .toBe("/__crit/frames/review%20space/candidate#section")
  })

  it("keeps archived Frames on their immutable artifact URL", () => {
    expect(frameIframeUrl("review", {
      ...frame,
      snapshot: { artifactId: "artifact" }
    }, { strategy: "relay" })).toBe(frame.url)
  })
})
