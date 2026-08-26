import { describe, expect, it } from "vitest"

import {
  decodeDeploymentRegisteredWire,
  decodeRegisterDeploymentWire,
  encodeDeploymentRegisteredWire,
  encodeRegisterDeploymentWire
} from "../src/index.js"

const registration = {
  kind: "register-deployment",
  schemaVersion: 1,
  applicationId: "application_checkout",
  channel: "review",
  url: "https://review.example.com/",
  sourceRevision: "commit_abc123",
  expiresAt: "2026-08-27T12:00:00.000Z"
}

const receipt = {
  kind: "deployment-registered",
  schemaVersion: 1,
  deploymentId: "deployment_checkout",
  applicationId: "application_checkout",
  channel: "review",
  url: "https://review.example.com/",
  sourceRevision: "commit_abc123",
  expiresAt: "2026-08-27T12:00:00.000Z"
}

describe("deployment registration protocol", () => {
  it("round trips registration requests and receipts", () => {
    const decodedRegistration = decodeRegisterDeploymentWire(registration)
    const decodedReceipt = decodeDeploymentRegisteredWire(receipt)

    expect(encodeRegisterDeploymentWire(decodedRegistration)).toEqual(registration)
    expect(encodeDeploymentRegisteredWire(decodedReceipt)).toEqual(receipt)
  })

  it("accepts omitted optional deployment fields", () => {
    const minimal = {
      kind: "register-deployment",
      schemaVersion: 1,
      applicationId: "application_checkout",
      channel: "review",
      url: "https://review.example.com/"
    }

    expect(encodeRegisterDeploymentWire(
      decodeRegisterDeploymentWire(minimal)
    )).toEqual(minimal)
  })

  it("rejects excess properties while decoding and encoding", () => {
    expect(() => decodeRegisterDeploymentWire({
      ...registration,
      personId: "person_forged"
    })).toThrow()
    expect(() => encodeDeploymentRegisteredWire({
      ...decodeDeploymentRegisteredWire(receipt),
      personId: "person_forged"
    })).toThrow()
  })
})
