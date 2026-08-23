import { describe, expect, it } from "vitest"

import { DomainValue } from "../src/index.js"

describe("DomainValue", () => {
  it("detaches nested values from caller ownership", () => {
    const input = { nested: { values: [1, 2, 3] } }
    const detached = DomainValue.detach(input)

    input.nested.values[0] = 9

    expect(detached).toEqual({ nested: { values: [1, 2, 3] } })
    expect(detached).not.toBe(input)
    expect(detached.nested).not.toBe(input.nested)
  })
})
