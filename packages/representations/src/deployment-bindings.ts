import type {
  ApplicationId,
  Deployment,
  DeploymentChannel,
  DeploymentId,
  IsoTimestamp
} from "@crit/domain"
import { Data, Effect, Layer, Option, Schema } from "effect"

import {
  ApplicationBaseUrl,
  ApplicationBindings
} from "./runtime.js"

export interface DeploymentApplicationBindingsOptions {
  readonly deployments: readonly Deployment[]
  readonly channel: DeploymentChannel
  readonly now: IsoTimestamp
}

export class DeploymentIdentityConflict extends Data.TaggedError(
  "DeploymentIdentityConflict"
)<{
  readonly deploymentId: DeploymentId
}> {}

export class DeploymentBindingConflict extends Data.TaggedError(
  "DeploymentBindingConflict"
)<{
  readonly applicationId: ApplicationId
  readonly channel: DeploymentChannel
}> {}

const decodeBaseUrl = Schema.decodeUnknownSync(ApplicationBaseUrl)

const makeBindings = (
  options: DeploymentApplicationBindingsOptions
): Effect.Effect<
  ApplicationBindings["Service"],
  DeploymentBindingConflict | DeploymentIdentityConflict
> => Effect.gen(function*() {
  const deploymentIds = new Set<DeploymentId>()
  const channelsByApplication = new Map<
    ApplicationId,
    Set<DeploymentChannel>
  >()
  const bindings = new Map<ApplicationId, ApplicationBaseUrl>()

  for (const deployment of options.deployments) {
    if (deploymentIds.has(deployment.deploymentId)) {
      yield* Effect.fail(new DeploymentIdentityConflict({
        deploymentId: deployment.deploymentId
      }))
    }
    deploymentIds.add(deployment.deploymentId)

    let channels = channelsByApplication.get(deployment.applicationId)
    if (channels === undefined) {
      channels = new Set()
      channelsByApplication.set(deployment.applicationId, channels)
    }
    if (channels.has(deployment.channel)) {
      yield* Effect.fail(new DeploymentBindingConflict({
        applicationId: deployment.applicationId,
        channel: deployment.channel
      }))
    }
    channels.add(deployment.channel)

    if (deployment.channel !== options.channel) continue
    if (
      deployment.expiresAt !== undefined &&
      deployment.expiresAt <= options.now
    ) continue
    bindings.set(
      deployment.applicationId,
      decodeBaseUrl(deployment.url)
    )
  }

  return ApplicationBindings.of({
    get: (applicationId) => Effect.succeed(
      Option.fromUndefinedOr(bindings.get(applicationId))
    )
  })
})

export const DeploymentApplicationBindings = {
  layer: (
    options: DeploymentApplicationBindingsOptions
  ): Layer.Layer<
    ApplicationBindings,
    DeploymentBindingConflict | DeploymentIdentityConflict
  > => Layer.effect(ApplicationBindings, makeBindings(options))
}
