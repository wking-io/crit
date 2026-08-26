import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import { Encoding, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  LocalBrowserConnection,
  LocalBrowserConnectionDescriptor,
  LocalBrowserConnectionInvalid
} from "../src/index.js"

const instance = Schema.decodeUnknownSync(LocalDaemonInstanceNonce)("0123456789abcdef0123456789abcdef")
const encodedJson = (value: Schema.Json) => `#crit=${Encoding.encodeBase64Url(JSON.stringify(value))}`

describe("LocalBrowserConnection", () => {
  it("round trips a strict descriptor into browser client options", () => {
    const descriptor = LocalBrowserConnection.make({
      baseUrl: "http://127.0.0.1:49152",
      instance
    })
    expect(descriptor).toEqual(LocalBrowserConnectionDescriptor.make({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:49152",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }))
    const fragment = LocalBrowserConnection.encode(descriptor)
    expect(fragment.startsWith("#crit=")).toBe(true)
    expect(fragment.length).toBeLessThanOrEqual(2_048)
    const decoded = LocalBrowserConnection.decode(fragment)
    expect(decoded).toEqual(Result.succeed(descriptor))
    if (Result.isSuccess(decoded)) {
      expect(LocalBrowserConnection.options(decoded.success)).toEqual({
        _tag: "browserSession",
        baseUrl: "http://127.0.0.1:49152",
        browserPath: "/browser/0123456789abcdef0123456789abcdef/"
      })
    }
  })

  it.each([
    { name: "empty", fragment: "", failure: new LocalBrowserConnectionInvalid({ reason: "fragment-missing" }) },
    { name: "wrong key", fragment: "#other=value", failure: new LocalBrowserConnectionInvalid({ reason: "fragment-missing" }) },
    { name: "missing value", fragment: "#crit=", failure: new LocalBrowserConnectionInvalid({ reason: "fragment-missing" }) },
    { name: "malformed base64url", fragment: "#crit=not+base64", failure: new LocalBrowserConnectionInvalid({ reason: "fragment-not-base64url" }) },
    { name: "oversized", fragment: `#crit=${"a".repeat(2_048)}`, failure: new LocalBrowserConnectionInvalid({ reason: "fragment-too-large" }) },
    { name: "wrong version", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 2,
      baseUrl: "http://127.0.0.1:49152",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }) },
    { name: "wrong tag", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "browserSession",
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:49152",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }) },
    { name: "non-loopback origin", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://localhost:49152",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }) },
    { name: "credentialed origin", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://user:pass@127.0.0.1:49152",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }) },
    { name: "origin with path", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:49152/api",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }) },
    { name: "port zero", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:0",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/"
    }) },
    { name: "malformed browser path", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:49152",
      browserPath: "/browser/wrong/"
    }) },
    { name: "excess field", failure: new LocalBrowserConnectionInvalid({ reason: "descriptor-invalid" }), fragment: encodedJson({
      _tag: "localBrowserConnection",
      schemaVersion: 1,
      baseUrl: "http://127.0.0.1:49152",
      browserPath: "/browser/0123456789abcdef0123456789abcdef/",
      extra: true
    }) }
  ])("rejects an invalid external fragment: $name", ({ failure, fragment }) => {
    expect(LocalBrowserConnection.decode(fragment)).toEqual(Result.fail(failure))
  })
})
