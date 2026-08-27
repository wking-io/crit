import {
  ApplicationRouteRepresentation,
  Id
} from "@crit/domain"
import {
  ChangeProtocol,
  decodeHostedApplicationResolveResponse,
  encodeHostedApplicationResolveRequest,
  hostedApplicationResolvePath
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { Predicate, Result } from "effect"
import { describe, expect, it } from "vitest"

const checkout = ApplicationRouteRepresentation.make({
  applicationId: Id.application("application_hosted_resolve"),
  route: "/checkout"
})

const postDeployment = (applicationId: string, channel = "review") => SELF.fetch(
  "https://crit.example/deployments",
  {
    method: "POST",
    headers: {
      authorization: "Bearer test-deploy-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      kind: "register-deployment",
      schemaVersion: 1,
      applicationId,
      channel,
      url: "https://preview.example/"
    })
  }
)

const resolve = (
  representation: ApplicationRouteRepresentation,
  access = true
) => {
  const headers = new Headers({
    "content-type": "application/json"
  })
  if (access) {
    headers.set("Cf-Access-Authenticated-User-Email", "ada@acme.com")
  }
  return SELF.fetch(`https://crit.example${hostedApplicationResolvePath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(encodeHostedApplicationResolveRequest({
      kind: "resolveApplicationRoute",
      schemaVersion: 1,
      representation
    }))
  })
}

describe("Worker hosted application route resolve", () => {
  it("allows anonymous resolve", async() => {
    const registered = await postDeployment(checkout.applicationId)
    const response = await resolve(checkout, false)
    const plan = decodeHostedApplicationResolveResponse(await response.json())

    expect(registered.status).toBe(200)
    expect(response.status).toBe(200)
    expect(Predicate.isTagged(plan, "iframe")).toBe(true)
  })

  it("resolves a registered review deployment into an iframe URL", async() => {
    const registered = await postDeployment(checkout.applicationId)
    const response = await resolve(checkout)
    const plan = decodeHostedApplicationResolveResponse(await response.json())

    expect(registered.status).toBe(200)
    expect(response.status).toBe(200)
    expect(Predicate.isTagged(plan, "iframe")).toBe(true)
    if (!Predicate.isTagged(plan, "iframe") || !("url" in plan)) return
    expect(plan.url).toBe("https://preview.example/checkout")
  })

  it("returns unavailable for an unbound application", async() => {
    const representation = ApplicationRouteRepresentation.make({
      applicationId: Id.application("application_hosted_unbound"),
      route: "/review"
    })
    const response = await resolve(representation)
    const plan = decodeHostedApplicationResolveResponse(await response.json())

    expect(response.status).toBe(200)
    expect(plan).toEqual({
      _tag: "unavailable",
      reason: "application-unbound",
      representation
    })
  })

  it("does not bind another deployment channel", async() => {
    const representation = ApplicationRouteRepresentation.make({
      applicationId: Id.application("application_hosted_production"),
      route: "/review"
    })
    await postDeployment(representation.applicationId, "production")
    const response = await resolve(representation)
    const plan = decodeHostedApplicationResolveResponse(await response.json())

    expect(Predicate.isTagged(plan, "unavailable")).toBe(true)
  })

  it("rejects an unsupported resolve schema version with an upgrade error", async() => {
    const response = await SELF.fetch(
      `https://crit.example${hostedApplicationResolvePath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Cf-Access-Authenticated-User-Email": "ada@acme.com"
        },
        body: JSON.stringify({
          kind: "resolveApplicationRoute",
          schemaVersion: 2,
          representation: checkout
        })
      }
    )
    const failure = ChangeProtocol.failure.decode(await response.json())

    expect(response.status).toBe(426)
    expect(Result.isSuccess(failure) && Predicate.isTagged(failure.success, "unsupportedVersion")).toBe(true)
  })
})
