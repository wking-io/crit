import {
  ApplicationRouteRepresentation,
  Id
} from "@crit/domain"
import { formatProtocolFailure } from "@crit/protocol"
import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  HostedAccessDenied,
  HostedReviewClient,
  HostedReviewUnreachable,
  type HostedReviewClientService
} from "../src/index.js"

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", mock)
  return mock
})

const representation = ApplicationRouteRepresentation.make({
  applicationId: Id.application("application_checkout"),
  route: "/checkout"
})
const baseUrl = "https://crit.example"

const withClient = <A, E>(
  use: (client: HostedReviewClientService) => Effect.Effect<A, E>
) => Effect.gen(function*() {
  const client = yield* HostedReviewClient
  return yield* use(client)
}).pipe(Effect.provide(HostedReviewClient.layer({ baseUrl })))

afterEach(() => {
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

describe("HostedReviewClient", () => {
  it("maps 401 responses from every operation to HostedAccessDenied", async() => {
    fetchMock.mockImplementation(async() => new Response(null, { status: 401 }))

    const identity = await Effect.runPromise(
      withClient((client) => Effect.flip(client.identity()))
    )
    const directory = await Effect.runPromise(
      withClient((client) => Effect.flip(client.directory()))
    )
    const resolve = await Effect.runPromise(
      withClient((client) => Effect.flip(
        client.resolveApplicationRoute(representation)
      ))
    )

    expect(identity).toEqual(new HostedAccessDenied())
    expect(directory).toEqual(new HostedAccessDenied())
    expect(resolve).toEqual(new HostedAccessDenied())
  })

  it("leaves fetch credentials unset for the browser same-origin default", async() => {
    fetchMock.mockImplementation(async() => new Response(JSON.stringify({
      kind: "access-authenticated-person",
      schemaVersion: 1,
      address: "grace@acme.com"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }))

    await Effect.runPromise(withClient((client) => client.identity()))
    const call = fetchMock.mock.calls[0]
    if (call === undefined) throw new Error("Hosted identity request missing")

    expect(call[1]?.credentials).toBeUndefined()
  })

  it("maps failed responses and undecodable bodies to HostedReviewUnreachable", async() => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("{", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))

    const failed = await Effect.runPromise(
      withClient((client) => Effect.flip(client.identity()))
    )
    const invalidJson = await Effect.runPromise(
      withClient((client) => Effect.flip(client.directory()))
    )
    const invalidSchema = await Effect.runPromise(
      withClient((client) => Effect.flip(
        client.resolveApplicationRoute(representation)
      ))
    )

    expect(failed).toBeInstanceOf(HostedReviewUnreachable)
    expect(invalidJson).toBeInstanceOf(HostedReviewUnreachable)
    expect(invalidSchema).toBeInstanceOf(HostedReviewUnreachable)
  })
})

describe("HostedReviewClient protocol negotiation", () => {
  it("fails a mismatched directory schema version with an upgrade error", async() => {
    fetchMock.mockImplementation(async() => new Response(JSON.stringify({
      kind: "canvas-directory",
      schemaVersion: 2,
      canvases: []
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }))

    const failure = await Effect.runPromise(
      withClient((client) => client.directory().pipe(Effect.flip))
    )

    expect(failure._tag).toBe("unsupportedVersion")
    if (failure._tag !== "unsupportedVersion") return
    expect(failure).toEqual({
      _tag: "unsupportedVersion",
      location: "message",
      requestedVersion: 2,
      supportedVersion: 1,
      message: "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
    })
    expect(formatProtocolFailure(failure)).toBe(
      "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
    )
  })

  it("fails a protocol-failure upgrade response from resolve", async() => {
    fetchMock.mockImplementation(async() => new Response(JSON.stringify({
      kind: "protocol-failure",
      schemaVersion: 1,
      failure: {
        _tag: "unsupportedVersion",
        location: "message",
        requestedVersion: 2,
        supportedVersion: 1,
        message: "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
      }
    }), {
      status: 426,
      headers: { "content-type": "application/json" }
    }))

    const failure = await Effect.runPromise(
      withClient((client) => Effect.flip(
        client.resolveApplicationRoute(
          ApplicationRouteRepresentation.make({
            applicationId: Id.application("application_protocol"),
            route: "/checkout"
          })
        )
      ))
    )

    expect(failure._tag).toBe("unsupportedVersion")
    if (failure._tag !== "unsupportedVersion") return
    expect(formatProtocolFailure(failure)).toBe(
      "Schema version 2 is unsupported. This installation speaks version 1. Upgrade Crit so the client and installation match."
    )
  })
})
