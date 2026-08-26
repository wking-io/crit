import {
  ApplicationRouteRepresentation,
  DeploymentChannel,
  Id,
  IsoTimestamp,
  type ApplicationId
} from "@crit/domain"
import {
  ArtifactStore,
  DeploymentApplicationBindings,
  LiveContent,
  RepresentationRuntime,
  RepresentationRuntimeLive
} from "@crit/representations"
import { env } from "cloudflare:workers"
import { SELF } from "cloudflare:test"
import { Crypto, Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { listControlDeployments } from "../src/deployments.js"

const review = Schema.decodeUnknownSync(DeploymentChannel)("review")
const now = Schema.decodeUnknownSync(IsoTimestamp)(
  "2026-08-25T12:00:00.000Z"
)
const checkout = ApplicationRouteRepresentation.make({
  applicationId: Id.application("application_hosted_resolve"),
  route: "/checkout"
})

interface RegistrationRequestBody {
  readonly kind: string
  readonly schemaVersion: number
  readonly applicationId: string
  readonly channel: string
  readonly url: string
  readonly expiresAt?: string
}

const postDeployment = (body: RegistrationRequestBody) => SELF.fetch(
  "https://crit.example/deployments",
  {
    method: "POST",
    headers: {
      authorization: "Bearer test-deploy-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  }
)

const inertArtifactStore = Layer.succeed(
  ArtifactStore,
  ArtifactStore.of({
    put: () => Effect.die("Application resolution touched the artifact store"),
    read: () => Effect.die("Application resolution touched the artifact store")
  })
)

const inertLiveContent = Layer.succeed(
  LiveContent,
  LiveContent.of({
    get: () => Effect.die("Application resolution touched live content")
  })
)

const cryptoLayer = Layer.succeed(Crypto.Crypto, Crypto.make({
  randomBytes: (size) => new Uint8Array(size),
  digest: (_algorithm, bytes) => Effect.succeed(bytes)
}))

const resolveRoute = (
  applicationId: ApplicationId,
  deployments: Awaited<ReturnType<typeof listControlDeployments>>
) => Effect.gen(function*() {
  const runtime = yield* RepresentationRuntime
  return yield* runtime.resolve(ApplicationRouteRepresentation.make({
    applicationId,
    route: "/checkout"
  }))
}).pipe(
  Effect.provide(RepresentationRuntimeLive.pipe(
    Layer.provide(Layer.mergeAll(
      DeploymentApplicationBindings.layer({
        deployments,
        channel: review,
        now
      }),
      inertArtifactStore,
      inertLiveContent,
      cryptoLayer
    ))
  ))
)

describe("hosted Deployment resolve", () => {
  it("resolves a review Deployment from D1 into an iframe URL", async() => {
    const response = await postDeployment({
      kind: "register-deployment",
      schemaVersion: 1,
      applicationId: checkout.applicationId,
      channel: "review",
      url: "https://preview.example/"
    })
    const deployments = await listControlDeployments(env)
    const listed = deployments.find((deployment) =>
      deployment.applicationId === checkout.applicationId
    )
    const plan = await Effect.runPromise(resolveRoute(
      checkout.applicationId,
      deployments
    ))

    expect(response.status).toBe(200)
    expect(listed?.url).toBe("https://preview.example/")
    expect(listed?.channel).toBe("review")
    expect(listed?._tag).toBe("deployment")
    expect("sourceRevision" in (listed ?? {})).toBe(false)
    expect("expiresAt" in (listed ?? {})).toBe(false)
    expect(plan._tag).toBe("iframe")
    if (plan._tag !== "iframe") return
    expect(plan.url).toBe("https://preview.example/checkout")
  })

  it("lists an expired row and does not bind it", async() => {
    const applicationId = Id.application("application_hosted_expired")
    const response = await postDeployment({
      kind: "register-deployment",
      schemaVersion: 1,
      applicationId,
      channel: "review",
      url: "https://preview.example/",
      expiresAt: "2026-08-25T12:00:00.000Z"
    })
    const deployments = await listControlDeployments(env)
    const listed = deployments.find((deployment) =>
      deployment.applicationId === applicationId
    )
    const plan = await Effect.runPromise(resolveRoute(
      applicationId,
      deployments
    ))

    expect(response.status).toBe(200)
    expect(listed?.expiresAt).toBe("2026-08-25T12:00:00.000Z")
    expect(plan._tag).toBe("unavailable")
    if (plan._tag !== "unavailable") return
    expect(plan.reason).toBe("application-unbound")
  })

  it("lists a different channel and does not bind it", async() => {
    const applicationId = Id.application("application_hosted_production")
    const response = await postDeployment({
      kind: "register-deployment",
      schemaVersion: 1,
      applicationId,
      channel: "production",
      url: "https://preview.example/"
    })
    const deployments = await listControlDeployments(env)
    const listed = deployments.find((deployment) =>
      deployment.applicationId === applicationId
    )
    const plan = await Effect.runPromise(resolveRoute(
      applicationId,
      deployments
    ))

    expect(response.status).toBe(200)
    expect(listed?.channel).toBe("production")
    expect(plan._tag).toBe("unavailable")
    if (plan._tag !== "unavailable") return
    expect(plan.reason).toBe("application-unbound")
  })
})
