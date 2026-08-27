import { IntegratedConnectionDocument, LocalBrowserConnection } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { HostRuntime, resolveHostRuntime } from "../src/index.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)
const loopback = "http://127.0.0.1:5173"
const injected = Schema.decodeUnknownSync(IntegratedConnectionDocument)({
  kind: "integrated",
  apiBase: "/__crit/"
})

describe("resolveHostRuntime", () => {
  it("treats loopback with an injected integrated document as integrated", () => {
    expect(resolveHostRuntime({
      origin: loopback,
      fragment: "",
      injected
    })).toEqual(HostRuntime.integrated({
      origin: loopback,
      apiBase: "/__crit/"
    }))
  })

  it("decodes #crit= as standalone when there is no inject", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })

    expect(resolveHostRuntime({
      origin: loopback,
      fragment: LocalBrowserConnection.encode(descriptor),
      injected: undefined
    })).toEqual(HostRuntime.standalone({ descriptor }))
  })

  it("prefers inject over a leftover standalone hash", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })

    expect(resolveHostRuntime({
      origin: loopback,
      fragment: LocalBrowserConnection.encode(descriptor),
      injected
    })).toEqual(HostRuntime.integrated({
      origin: loopback,
      apiBase: "/__crit/"
    }))
  })

  it("tells a disconnected loopback host to run crit dev", () => {
    expect(resolveHostRuntime({
      origin: loopback,
      fragment: "",
      injected: undefined
    })).toEqual(HostRuntime.invalid({
      reason: "This Crit host is not connected. Run crit dev."
    }))
  })

  it("does not use the hosted-HTTPS copy for disconnected loopback", () => {
    const runtime = resolveHostRuntime({
      origin: loopback,
      fragment: "",
      injected: undefined
    })
    expect(HostRuntime.$is("invalid")(runtime)).toBe(true)
    if (HostRuntime.$is("invalid")(runtime)) {
      expect(runtime.reason).not.toBe("Hosted mode requires a non-loopback HTTPS origin.")
    }
  })

  it("parses a fragment-free non-loopback HTTPS origin as hosted", () => {
    expect(resolveHostRuntime({
      origin: "https://crit.example",
      fragment: "",
      injected: undefined
    })).toEqual(HostRuntime.hosted())
  })

  it("keeps a corrupt local capability invalid on a hosted origin", () => {
    expect(resolveHostRuntime({
      origin: "https://crit.example",
      fragment: "#crit=",
      injected: undefined
    })).toEqual(HostRuntime.invalid({ reason: "fragment-missing" }))
  })

  it("rejects fragment-free insecure and localhost origins", () => {
    expect(HostRuntime.$is("invalid")(resolveHostRuntime({
      origin: "https://localhost:5173",
      fragment: "",
      injected: undefined
    }))).toBe(true)
    expect(HostRuntime.$is("invalid")(resolveHostRuntime({
      origin: "https://127.0.0.1",
      fragment: "",
      injected: undefined
    }))).toBe(true)
    expect(HostRuntime.$is("invalid")(resolveHostRuntime({
      origin: "http://crit.example",
      fragment: "",
      injected: undefined
    }))).toBe(true)
  })
})
