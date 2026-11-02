import { fileURLToPath } from "node:url"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { Option, Result, Schema } from "effect"
import { BrowserOrigin } from "@crit/client"

import { HOST_ORIGIN, hostListenPort, resolveHostRoot } from "../src/host-app.js"
import { parseDevHostRequest } from "../src/dev-host-request.js"

describe("Portless host configuration", () => {
  it("uses the assigned listener port and advertised origin independently", () => {
    const environment = { PORT: "4321", PORTLESS_URL: "https://crit.localhost:1355" }
    expect(hostListenPort(environment)).toBe(4321)
    expect(parseDevHostRequest({ browserOrigin: Option.none(), noHost: false }, environment)).toEqual(
      Result.succeed({ _tag: "Integrated", hostOrigin: "https://crit.localhost:1355" })
    )
  })

  it.each(["", "0", "65536", "4321oops", "4.5"])("rejects invalid PORT=%s", (PORT) => {
    expect(() => hostListenPort({ PORT })).toThrow()
  })

  it.each(["http://127.0.0.1:5173", "https://crit.localhost", "https://branch.crit.localhost:1355"])(
    "accepts the local origin %s", (origin) => expect(Schema.is(BrowserOrigin)(origin)).toBe(true)
  )

  it.each(["https://example.com", "https://crit.localhost.example.com", "https://user@crit.localhost", "https://crit.localhost/path", "https://crit.localhost:65536", "file://crit.localhost"])(
    "rejects the non-local or malformed origin %s", (origin) => expect(Schema.is(BrowserOrigin)(origin)).toBe(false)
  )
})

describe("resolveHostRoot", () => {
  it("finds the monorepo host package", () => {
    expect(resolveHostRoot()).toBe(
      path.resolve(fileURLToPath(new URL("../../host", import.meta.url)))
    )
    expect(HOST_ORIGIN).toBe("http://127.0.0.1:5173")
  })

  it("returns undefined when the host package is missing", () => {
    expect(resolveHostRoot("/tmp/crit-missing-host")).toBeUndefined()
  })
})
