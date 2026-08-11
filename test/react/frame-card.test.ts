import { describe, expect, it } from "vitest"

import { frameFetchTarget } from "../../src/react/frame-card.js"

describe("frameFetchTarget", () => {
  const pageOrigin = "https://actual-portal.example"

  it("fetches a trusted public alias through its relative resource route", () => {
    expect(frameFetchTarget(
      new URL("https://portal.example/frames/ready?variant=2#section"),
      pageOrigin,
      "https://portal.example"
    )).toEqual({
      target: "/frames/ready?variant=2",
      fetchOrigin: pageOrigin
    })
  })

  it("keeps actual same-origin fetches absolute", () => {
    expect(frameFetchTarget(
      new URL("https://actual-portal.example/frames/ready?variant=2"),
      pageOrigin,
      "https://portal.example"
    )).toEqual({
      target: "https://actual-portal.example/frames/ready?variant=2",
      fetchOrigin: pageOrigin
    })
  })

  it("rejects unrelated cross-origin frames", () => {
    expect(frameFetchTarget(
      new URL("https://untrusted.example/frames/ready"),
      pageOrigin,
      "https://portal.example"
    )).toBeNull()
  })
})
