import { describe, expect, it } from "vitest"

import {
  decodeHostedApplicationResolveRequest,
  decodeHostedApplicationResolveResponse,
  encodeHostedApplicationResolveRequest,
  encodeHostedApplicationResolveResponse
} from "../src/index.js"

const representation = {
  _tag: "applicationRoute",
  applicationId: "application_checkout",
  route: "/checkout"
}

describe("hosted application route protocol", () => {
  it("round trips resolve requests and responses", () => {
    const request = {
      kind: "resolveApplicationRoute",
      schemaVersion: 1,
      representation
    }
    const response = {
      _tag: "iframe",
      representation,
      url: "https://review.example.com/checkout"
    }

    expect(encodeHostedApplicationResolveRequest(
      decodeHostedApplicationResolveRequest(request)
    )).toEqual(request)
    expect(encodeHostedApplicationResolveResponse(
      decodeHostedApplicationResolveResponse(response)
    )).toEqual(response)
  })

  it("round trips an unbound application response", () => {
    const response = {
      _tag: "unavailable",
      reason: "application-unbound",
      representation
    }

    expect(encodeHostedApplicationResolveResponse(
      decodeHostedApplicationResolveResponse(response)
    )).toEqual(response)
  })
})
