import {
  ApplicationRouteRepresentation,
  Id
} from "@crit/domain"
import {
  decodeHostedApplicationResolveResponse,
  encodeHostedApplicationResolveRequest,
  hostedApplicationResolvePath
} from "@crit/protocol"
import { SELF } from "cloudflare:test"
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
) => SELF.fetch(`https://crit.example${hostedApplicationResolvePath}`, {
  method: "POST",
  headers: {
    ...(access
      ? { "Cf-Access-Authenticated-User-Email": "ada@acme.com" }
      : {}),
    "content-type": "application/json"
  },
  body: JSON.stringify(encodeHostedApplicationResolveRequest({
    kind: "resolveApplicationRoute",
    schemaVersion: 1,
    representation
  }))
})

describe("Worker hosted application route resolve", () => {
  it("requires Access", async() => {
    const response = await resolve(checkout, false)

    expect(response.status).toBe(401)
    expect(await response.text()).toBe("")
  })

  it("resolves a registered review deployment into an iframe URL", async() => {
    const registered = await postDeployment(checkout.applicationId)
    const response = await resolve(checkout)
    const plan = decodeHostedApplicationResolveResponse(await response.json())

    expect(registered.status).toBe(200)
    expect(response.status).toBe(200)
    expect(plan._tag).toBe("iframe")
    if (plan._tag !== "iframe") return
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

    expect(plan._tag).toBe("unavailable")
  })
})
