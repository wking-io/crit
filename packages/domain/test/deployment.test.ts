import { Predicate, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  Deployment,
  DeploymentChannel,
  DeploymentUrl,
  Id,
  IsoTimestamp,
  SourceRevision,
  decodeDeployment
} from "../src/index.js"

const decodeChannel = Schema.decodeUnknownSync(DeploymentChannel)
const decodeUrl = Schema.decodeUnknownSync(DeploymentUrl)

describe("DeploymentUrl", () => {
  const decode = Schema.decodeUnknownResult(DeploymentUrl)

  it.each([
    "https://preview.example/",
    "http://review.example:8080/",
    "https://xn--bcher-kva.example/",
    "https://checkout-abc.workers.dev/"
  ])("accepts the canonical public authority root %s", (value) => {
    expect(Result.isSuccess(decode(value))).toBe(true)
  })

  it.each([
    "ftp://preview.example/",
    "https://user:secret@preview.example/",
    "https://preview.example/checkout",
    "https://preview.example/?",
    "https://preview.example/?mode=wide",
    "https://preview.example/#canvas",
    "https://preview.example",
    "https://PREVIEW.example/",
    "https://localhost/",
    "https://app.localhost/",
    "https://127.0.0.1/",
    "http://127.0.0.1:5173/",
    "https://0.0.0.0/",
    "https://[::1]/",
    "https://2130706433/",
    "https://0177.0.0.1/",
    "https://0x7f.0x0.0x0.0x1/",
    "https://preview.example./",
    "https://preview/",
    "https://-preview.example/",
    "https://preview-.example/",
    "https://preview_example.com/",
    "https://preview..example/",
    "http://preview.example:80/",
    "https://preview.example:443/",
    "https://preview.example:0443/",
    "https://preview.example:0/",
    "https://preview.example:65536/"
  ])("rejects the private, malformed, or non-canonical URL %s", (value) => {
    expect(Result.isFailure(decode(value))).toBe(true)
  })
})

describe("DeploymentChannel", () => {
  const decode = Schema.decodeUnknownResult(DeploymentChannel)

  it.each([
    "a",
    "review",
    `r${"1".repeat(63)}`
  ])("accepts %s", (value) => {
    expect(Result.isSuccess(decode(value))).toBe(true)
  })

  it.each([
    "",
    "Review",
    "1-review",
    "review_channel",
    "review channel",
    `r${"1".repeat(64)}`
  ])("rejects %s", (value) => {
    expect(Result.isFailure(decode(value))).toBe(true)
  })
})

describe("Deployment", () => {
  const complete = {
    _tag: "deployment",
    deploymentId: "deployment_checkout_review",
    applicationId: "application_storefront",
    channel: "review",
    url: "https://preview.example/",
    sourceRevision: "commit_abc123",
    expiresAt: "2026-08-26T00:00:00.000Z"
  }

  it("round-trips optional source and expiry fields", () => {
    const decoded = decodeDeployment(complete)
    expect(Schema.encodeSync(Deployment)(decoded)).toEqual(complete)
    expect(decodeDeployment({
      _tag: "deployment",
      deploymentId: "deployment_checkout_permanent",
      applicationId: "application_storefront",
      channel: "production",
      url: "https://storefront.example/"
    })).toEqual({
      _tag: "deployment",
      deploymentId: "deployment_checkout_permanent",
      applicationId: "application_storefront",
      channel: "production",
      url: "https://storefront.example/"
    })
  })

  it("rejects blank source revisions and malformed expiry timestamps", () => {
    expect(() => decodeDeployment({
      ...complete,
      sourceRevision: " "
    })).toThrow()
    expect(() => decodeDeployment({
      ...complete,
      expiresAt: "2026-08-26T00:00:00Z"
    })).toThrow()
  })

  it.each([
    { baseUrl: "https://preview.example/" },
    { canvasId: "canvas_checkout" },
    { iframePolicy: "allow-scripts" },
    { binding: { applicationId: "application_storefront" } }
  ])("rejects the excess field %#", (extra) => {
    expect(() => decodeDeployment({ ...complete, ...extra })).toThrow()
  })

  it("constructs a tagged deployment without a caller-supplied tag", () => {
    const deployment = Deployment.make({
      deploymentId: Id.deployment("deployment_checkout_make"),
      applicationId: Id.application("application_storefront"),
      channel: decodeChannel("review"),
      url: decodeUrl("https://preview.example/"),
      sourceRevision: Schema.decodeUnknownSync(SourceRevision)("commit_abc123"),
      expiresAt: Schema.decodeUnknownSync(IsoTimestamp)(
        "2026-08-26T00:00:00.000Z"
      )
    })

    expect(Predicate.isTagged(deployment, "deployment")).toBe(true)
    expect(deployment.deploymentId).toBe("deployment_checkout_make")
  })
})
