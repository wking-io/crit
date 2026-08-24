import { LocalBrowserConnection } from "@crit/client"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { describe, expect, it } from "vitest"

import { hostScreenAtom } from "../src/host-atoms.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)(
  "0123456789abcdef0123456789abcdef"
)

describe("hostScreenAtom", () => {
  it("is invalid for a bad fragment and can be read after the registry is replaced", () => {
    const atom = hostScreenAtom("#crit=")
    const first = AtomRegistry.make()
    expect(first.get(atom)).toEqual({ _tag: "invalid" })
    first.dispose()
    expect(() => first.get(atom)).toThrow(/disposed/)
    const second = AtomRegistry.make()
    expect(second.get(atom)).toEqual({ _tag: "invalid" })
    second.dispose()
  })

  it("starts connecting for a valid fragment", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    const registry = AtomRegistry.make()
    expect(registry.get(hostScreenAtom(LocalBrowserConnection.encode(descriptor)))._tag)
      .toBe("connecting")
    registry.dispose()
  })
})
