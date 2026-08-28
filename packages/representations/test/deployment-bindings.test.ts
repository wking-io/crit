import {
  ApplicationRouteRepresentation,
  Deployment,
  DeploymentChannel,
  DeploymentUrl,
  Frame,
  Id,
  IsoTimestamp,
  RepresentationRef,
  type ApplicationId
} from "@crit/domain"
import {
  Context,
  Crypto,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Result,
  Schema
} from "effect"
import { describe, expect, it } from "vitest"

import {
  ApplicationBaseUrl,
  ApplicationBindings,
  ArtifactStore,
  DeploymentApplicationBindings,
  DeploymentBindingConflict,
  DeploymentIdentityConflict,
  LiveContent,
  RepresentationRuntime,
  RepresentationRuntimeLive
} from "../src/index.js"

const applicationId = Id.application("application_storefront")
const review = Schema.decodeUnknownSync(DeploymentChannel)("review")
const production = Schema.decodeUnknownSync(DeploymentChannel)("production")
const previewUrl = Schema.decodeUnknownSync(DeploymentUrl)(
  "https://preview.example/"
)
const now = Schema.decodeUnknownSync(IsoTimestamp)(
  "2026-08-25T12:00:00.000Z"
)
const decodeTimestamp = Schema.decodeUnknownSync(IsoTimestamp)

interface DeploymentFixtureOptions {
  readonly id: string
  readonly applicationId?: ApplicationId
  readonly channel?: DeploymentChannel
  readonly url?: DeploymentUrl
  readonly expiresAt?: IsoTimestamp
}

const deployment = (options: DeploymentFixtureOptions) => {
  const required = {
    deploymentId: Id.deployment(options.id),
    applicationId: options.applicationId ?? applicationId,
    channel: options.channel ?? review,
    url: options.url ?? previewUrl
  }
  return options.expiresAt === undefined
    ? Deployment.make(required)
    : Deployment.make({ ...required, expiresAt: options.expiresAt })
}

const deploymentBindings = (
  deployments: readonly Deployment[],
  channel: DeploymentChannel = review
) => DeploymentApplicationBindings.layer({ deployments, channel, now })

const getBinding = (
  layer: ReturnType<typeof deploymentBindings>,
  requestedApplicationId: ApplicationId
) => Effect.scoped(Effect.gen(function*() {
  const context = yield* Layer.build(layer)
  const bindings = Context.get(context, ApplicationBindings)
  return yield* bindings.get(requestedApplicationId)
}))

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

const runtimeLayer = <E>(
  bindings: Layer.Layer<ApplicationBindings, E>
) => RepresentationRuntimeLive.pipe(
  Layer.provide(Layer.mergeAll(
    bindings,
    inertArtifactStore,
    inertLiveContent,
    cryptoLayer
  ))
)

describe("DeploymentApplicationBindings", () => {
  it("resolves one unchanged Frame through local and review bindings", async() => {
    const representation = ApplicationRouteRepresentation.make({
      applicationId,
      route: "/checkout",
      state: { cart: { quantity: 1 } }
    })
    const changeId = Id.change("change_deployment_binding")
    const frame = Frame.make({
      frameId: Id.frame("frame_checkout"),
      title: "Checkout",
      representation,
      status: "ready-for-review",
      geometry: { x: 0, y: 0, width: 390, height: 844 },
      createdByChangeId: changeId,
      updatedByChangeId: changeId,
      titleChangedByChangeId: changeId,
      representationChangedByChangeId: changeId,
      statusChangedByChangeId: changeId,
      geometryChangedByChangeId: changeId
    })
    const frameRepresentation = frame.representation
    const frameBytes = JSON.stringify(Schema.encodeSync(Frame)(frame))
    const representationBytes = JSON.stringify(
      Schema.encodeSync(RepresentationRef)(representation)
    )
    const localBaseUrl = Schema.decodeUnknownSync(ApplicationBaseUrl)(
      "http://127.0.0.1:5173/"
    )
    const localBindings = Layer.succeed(
      ApplicationBindings,
      ApplicationBindings.of({
        get: (requestedApplicationId) => Effect.succeed(
          requestedApplicationId === applicationId
            ? Option.some(localBaseUrl)
            : Option.none()
        )
      })
    )
    const sharedBindings = deploymentBindings([
      deployment({ id: "deployment_checkout_review" })
    ])
    const resolve = <E>(bindings: Layer.Layer<ApplicationBindings, E>) =>
      Effect.gen(function*() {
        const runtime = yield* RepresentationRuntime
        return yield* runtime.resolve(frame.representation)
      }).pipe(Effect.provide(runtimeLayer(bindings)))

    const local = await Effect.runPromise(resolve(localBindings))
    const shared = await Effect.runPromise(resolve(sharedBindings))

    expect(Predicate.isTagged(local, "iframe")).toBe(true)
    expect(Predicate.isTagged(shared, "iframe")).toBe(true)
    const localIframe = Match.value(local).pipe(Match.tag("iframe", (plan) => plan), Match.option)
    const sharedIframe = Match.value(shared).pipe(Match.tag("iframe", (plan) => plan), Match.option)
    if (Option.isNone(localIframe) || Option.isNone(sharedIframe)) return
    expect(localIframe.value.url).toBe("http://127.0.0.1:5173/checkout")
    expect(sharedIframe.value.url).toBe("https://preview.example/checkout")
    expect(JSON.stringify(
      Schema.encodeSync(RepresentationRef)(localIframe.value.representation)
    )).toBe(representationBytes)
    expect(JSON.stringify(
      Schema.encodeSync(RepresentationRef)(sharedIframe.value.representation)
    )).toBe(representationBytes)
    expect(JSON.stringify(Schema.encodeSync(Frame)(frame))).toBe(frameBytes)
    expect(frame.representation).toBe(frameRepresentation)
  })

  it("stays unbound without a review Deployment and never invents a loopback origin", async() => {
    const result = await Effect.runPromise(getBinding(
      deploymentBindings([]),
      applicationId
    ))
    expect(Option.isNone(result)).toBe(true)
  })

  it("leaves another application unbound", async() => {
    const result = await Effect.runPromise(getBinding(
      deploymentBindings([deployment({ id: "deployment_bound" })]),
      Id.application("application_other")
    ))
    expect(Option.isNone(result)).toBe(true)
  })

  it("does not bind a deployment from another channel", async() => {
    const result = await Effect.runPromise(getBinding(
      deploymentBindings([
        deployment({
          id: "deployment_production",
          channel: production
        })
      ]),
      applicationId
    ))
    expect(Option.isNone(result)).toBe(true)
  })

  it.each([
    "2026-08-25T11:59:59.999Z",
    "2026-08-25T12:00:00.000Z"
  ])("treats expiry at or before now as unbound", async(expiresAt) => {
    const result = await Effect.runPromise(getBinding(
      deploymentBindings([
        deployment({
          id: `deployment_expired_${expiresAt.slice(11, 19).replaceAll(":", "")}`,
          expiresAt: decodeTimestamp(expiresAt)
        })
      ]),
      applicationId
    ))
    expect(Option.isNone(result)).toBe(true)
  })

  it("binds an unexpired deployment", async() => {
    const result = await Effect.runPromise(getBinding(
      deploymentBindings([
        deployment({
          id: "deployment_unexpired",
          expiresAt: decodeTimestamp("2026-08-25T12:00:00.001Z")
        })
      ]),
      applicationId
    ))
    expect(Option.getOrUndefined(result)).toBe("https://preview.example/")
  })

  it("fails when a deployment identity appears twice", async() => {
    const repeated = deployment({ id: "deployment_repeated" })
    const result = await Effect.runPromise(Effect.scoped(
      Layer.build(deploymentBindings([repeated, repeated])).pipe(Effect.result)
    ))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return
    expect(result.failure).toEqual(new DeploymentIdentityConflict({
      deploymentId: repeated.deploymentId
    }))
  })

  it("fails duplicate application channels before selection or expiry", async() => {
    const result = await Effect.runPromise(Effect.scoped(
      Layer.build(deploymentBindings([
        deployment({
          id: "deployment_production_old",
          channel: production,
          expiresAt: decodeTimestamp("2026-08-24T12:00:00.000Z")
        }),
        deployment({
          id: "deployment_production_new",
          channel: production
        })
      ])).pipe(Effect.result)
    ))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) return
    expect(result.failure).toEqual(new DeploymentBindingConflict({
      applicationId,
      channel: production
    }))
  })

  it("allows two channels and binds only the requested channel", async() => {
    const productionUrl = Schema.decodeUnknownSync(DeploymentUrl)(
      "https://storefront.example/"
    )
    const deployments = [
      deployment({
        id: "deployment_two_channels_production",
        channel: production,
        url: productionUrl
      }),
      deployment({
        id: "deployment_two_channels_review"
      })
    ]
    const reviewResult = await Effect.runPromise(getBinding(
      deploymentBindings(deployments),
      applicationId
    ))
    const productionResult = await Effect.runPromise(getBinding(
      deploymentBindings(deployments, production),
      applicationId
    ))

    expect(Option.getOrUndefined(reviewResult)).toBe(
      "https://preview.example/"
    )
    expect(Option.getOrUndefined(productionResult)).toBe(
      "https://storefront.example/"
    )
  })
})
