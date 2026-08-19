import { describe, expect, it } from "vitest"

import {
  WOVEN_AVATAR_FAMILIES,
  wovenAvatarFor
} from "../../src/react/woven-avatar.js"

describe("wovenAvatarFor", () => {
  it("keeps an identity's pattern stable across calls", () => {
    const first = wovenAvatarFor("git:willa")
    const second = wovenAvatarFor("git:willa")

    expect(first.family).toBe(second.family)
    expect(first.cells).toEqual(second.cells)
    expect(first.accentCells).toEqual(second.accentCells)
    expect(first.palette).toEqual(second.palette)
  })

  it("does not include checker and stays in the v3 occupancy band", () => {
    const identities = [
      "current-author:git:willa",
      "codex-1",
      "anonymous-agent",
      "agent-0",
      "agent-1",
      "agent-2",
      "agent-3",
      "git:ava",
      "git:jules"
    ]
    const specs = identities.map(wovenAvatarFor)

    expect(WOVEN_AVATAR_FAMILIES).not.toContain("checker")
    expect(specs.every((spec) =>
      WOVEN_AVATAR_FAMILIES.includes(spec.family)
    )).toBe(true)
    expect(specs.every((spec) =>
      spec.occupancy >= 0.2 && spec.occupancy <= 0.78
    )).toBe(true)
    expect(new Set(specs.map((spec) => spec.cells.map(Number).join(""))).size)
      .toBeGreaterThan(1)
  })

  it("paints with Crit color tokens", () => {
    const spec = wovenAvatarFor("current-author:git:willa")

    expect(spec.palette.background).toContain("var(--crit-color-")
    expect(spec.palette.foreground).toContain("var(--crit-color-")
    expect(spec.palette.accent).toContain("var(--crit-color-")
    expect(spec.cells).toHaveLength(121)
    expect(spec.accentCells.length).toBeGreaterThanOrEqual(5)
  })
})
