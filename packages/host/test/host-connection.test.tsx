import { LocalBrowserConnection, LocalBrowserConnectionInvalid } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { hostConnectionFromFragment } from "../src/index.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

describe("hostConnectionFromFragment", () => {
  it("accepts a fragment produced by LocalBrowserConnection.encode", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    expect(hostConnectionFromFragment(LocalBrowserConnection.encode(descriptor)))
      .toEqual(Result.succeed(descriptor))
  })

  it("rejects an empty fragment", () => {
    expect(hostConnectionFromFragment("")).toEqual(
      Result.fail(new LocalBrowserConnectionInvalid({ reason: "fragment-missing" }))
    )
  })

  it("rejects a #crit= fragment without a value", () => {
    expect(hostConnectionFromFragment("#crit=")).toEqual(
      Result.fail(new LocalBrowserConnectionInvalid({ reason: "fragment-missing" }))
    )
  })
})
