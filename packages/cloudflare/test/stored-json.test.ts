import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  DurableSqlRowLimitExceeded,
  durableObjectSqlRowLimitBytes,
  encodeDurableSqlText
} from "../src/stored-json.js"

describe("encodeDurableSqlText", () => {
  const exactLimit = "é".repeat(durableObjectSqlRowLimitBytes / 2)

  it("accepts text exactly at the Durable Object SQL row limit", async () => {
    await expect(Effect.runPromise(encodeDurableSqlText(exactLimit))).resolves.toBe(exactLimit)
  })

  it("fails with byte counts when text is one byte over the limit", async () => {
    const error = await Effect.runPromise(Effect.flip(encodeDurableSqlText(`${exactLimit}a`)))

    expect(error).toBeInstanceOf(DurableSqlRowLimitExceeded)
    expect(error).toMatchObject({
      _tag: "DurableSqlRowLimitExceeded",
      bytes: durableObjectSqlRowLimitBytes + 1,
      limit: durableObjectSqlRowLimitBytes
    })
  })
})
