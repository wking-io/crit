import { LocalBrowserConnection } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { HostConnection, parseHostConnection } from "../src/index.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

describe("parseHostConnection", () => {
  it("parses a local capability before considering the origin", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })

    expect(parseHostConnection({
      fragment: LocalBrowserConnection.encode(descriptor),
      origin: "http://127.0.0.1:5173"
    })).toEqual(HostConnection.local({ descriptor }))
  })

  it("parses a fragment-free non-loopback HTTPS origin as hosted", () => {
    expect(parseHostConnection({
      fragment: "",
      origin: "https://crit.example"
    })).toEqual(HostConnection.hosted())
  })

  it("keeps a corrupt local capability invalid on a hosted origin", () => {
    expect(parseHostConnection({
      fragment: "#crit=",
      origin: "https://crit.example"
    })).toEqual(HostConnection.invalid({ reason: "fragment-missing" }))
  })

  it("rejects fragment-free loopback and insecure origins", () => {
    expect(HostConnection.$is("invalid")(parseHostConnection({
      fragment: "",
      origin: "https://localhost:5173"
    }))).toBe(true)
    expect(HostConnection.$is("invalid")(parseHostConnection({
      fragment: "",
      origin: "https://127.0.0.1"
    }))).toBe(true)
    expect(HostConnection.$is("invalid")(parseHostConnection({
      fragment: "",
      origin: "http://crit.example"
    }))).toBe(true)
  })
})
