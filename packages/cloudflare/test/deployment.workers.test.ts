import { decodeDeploymentRegisteredWire } from "@crit/protocol"
import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const registration = {
  kind: "register-deployment",
  schemaVersion: 1,
  applicationId: "application_worker_registration",
  channel: "review",
  url: "https://first.example.com/",
  sourceRevision: "commit_first",
  expiresAt: "2026-08-27T12:00:00.000Z"
}

interface RegistrationRequestBody {
  readonly kind: string
  readonly schemaVersion: number
  readonly applicationId: string
  readonly channel: string
  readonly url: string
  readonly sourceRevision?: string
  readonly expiresAt?: string
}

const post = (
  body: RegistrationRequestBody,
  token = "test-deploy-token"
) => SELF.fetch(
  "https://crit.example/deployments",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  }
)

const receiptFrom = async(response: Response) => {
  const body: unknown = await response.json()
  return decodeDeploymentRegisteredWire(body)
}

describe("Worker deployment registration route", () => {
  it("requires the deployment bearer token", async() => {
    const missing = await SELF.fetch("https://crit.example/deployments", {
      method: "POST",
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@acme.com",
        "content-type": "application/json"
      },
      body: JSON.stringify(registration)
    })
    const wrong = await post(registration, "wrong-token")

    expect(missing.status).toBe(401)
    expect(await missing.text()).toBe("")
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toBe("")
  })

  it("registers once and replaces mutable fields without changing identity", async() => {
    const firstResponse = await post(registration)
    const first = await receiptFrom(firstResponse)
    const retryResponse = await post(registration)
    const retry = await receiptFrom(retryResponse)
    const replacementResponse = await post({
      ...registration,
      url: "https://replacement.example.com/",
      sourceRevision: "commit_second",
      expiresAt: "2026-08-28T12:00:00.000Z"
    })
    const replacement = await receiptFrom(replacementResponse)

    expect(firstResponse.status).toBe(200)
    expect(first.deploymentId).toMatch(
      /^deployment_[0-9a-f]{32}$/
    )
    expect(retry).toEqual(first)
    expect(replacement).toEqual({
      ...first,
      url: "https://replacement.example.com/",
      sourceRevision: "commit_second",
      expiresAt: "2026-08-28T12:00:00.000Z"
    })
  })

  it("rejects invalid JSON, invalid deployment data, and other methods", async() => {
    const invalidJson = await SELF.fetch("https://crit.example/deployments", {
      method: "POST",
      headers: {
        authorization: "Bearer test-deploy-token",
        "content-type": "application/json"
      },
      body: "{"
    })
    const invalidUrl = await post({
      ...registration,
      applicationId: "application_worker_invalid_url",
      url: "http://localhost:5173/"
    })
    const wrongMethod = await SELF.fetch(
      "https://crit.example/deployments",
      { method: "PUT" }
    )

    expect(invalidJson.status).toBe(400)
    expect(invalidUrl.status).toBe(400)
    expect(wrongMethod.status).toBe(405)
  })

  it("leaves the identity route working", async() => {
    const response = await SELF.fetch("https://crit.example/identity", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      }
    })

    expect(response.status).toBe(200)
  })
})
