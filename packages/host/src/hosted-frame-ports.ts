import type {
  HostedReviewClientService,
  HostedReviewFailure
} from "@crit/client"
import {
  ArtifactRepresentation,
  WebUrlRepresentation,
  type RepresentationRef
} from "@crit/domain"
import type {
  FrameRepresentationResolver,
  FrameSnapshotter
} from "@crit/react"
import {
  ArtifactBytesRenderPlan,
  ArtifactStore,
  ArtifactUnavailableRenderPlan,
  IframeRenderPlan,
  type RenderPlan
} from "@crit/representations"
import { Data, Effect, Match } from "effect"

export interface HostedFramePorts {
  readonly resolver: FrameRepresentationResolver
  readonly snapshotter: FrameSnapshotter
}

export class HostedCaptureUnavailable extends Data.TaggedError(
  "HostedCaptureUnavailable"
)<{
  readonly reason: string
}> {}

export const hostedFramePorts = (
  client: HostedReviewClientService
): Effect.Effect<
  HostedFramePorts,
  HostedReviewFailure,
  ArtifactStore
> => Effect.gen(function*() {
  const artifacts = yield* ArtifactStore
  const resolve = Match.type<RepresentationRef>().pipe(Match.tagsExhaustive({
    "applicationRoute": (representation) =>
      client.resolveApplicationRoute(representation),
    "webUrl": (input): Effect.Effect<RenderPlan> => {
      const representation = WebUrlRepresentation.make({ url: input.url })
      return Effect.succeed(IframeRenderPlan.make({
        representation,
        url: representation.url
      }))
    },
    artifact: (input) => {
      const representation = ArtifactRepresentation.make({
        artifactId: input.artifactId,
        digest: input.digest
      })
      return artifacts.read(representation).pipe(
        Effect.map((bytes): RenderPlan => ArtifactBytesRenderPlan.make({
          representation,
          bytes
        })),
        Effect.catchTags({
          ArtifactNotFound: (): Effect.Effect<RenderPlan> => Effect.succeed(
            ArtifactUnavailableRenderPlan.make({
              reason: "artifact-not-found",
              representation
            })
          ),
          ArtifactCorrupt: (): Effect.Effect<RenderPlan> => Effect.succeed(
            ArtifactUnavailableRenderPlan.make({
              reason: "artifact-corrupt",
              representation
            })
          )
        })
      )
    }
  }))
  return {
    resolver: { resolve },
    snapshotter: {
      capture: () => Effect.fail(new HostedCaptureUnavailable({
        reason: "Snapshot capture needs a Crit install."
      }))
    }
  }
})
