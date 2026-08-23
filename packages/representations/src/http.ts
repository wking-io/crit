import { RepresentationRef } from "@crit/domain"
import { Schema } from "effect"

import {
  ApplicationUnavailableRenderPlan,
  ArtifactUnavailableRenderPlan,
  IframeRenderPlan
} from "./runtime.js"

export const localRepresentationResolvePath = "/api/v1/representations/resolve"

export const LocalRepresentationResolveRequest = Schema.TaggedStruct("resolve-representation", {
  schemaVersion: Schema.Literal(1),
  representation: RepresentationRef
})
export type LocalRepresentationResolveRequest = typeof LocalRepresentationResolveRequest.Type

export const LocalRepresentationJsonResponse = Schema.Union([
  IframeRenderPlan,
  ApplicationUnavailableRenderPlan,
  ArtifactUnavailableRenderPlan
])
export type LocalRepresentationJsonResponse = typeof LocalRepresentationJsonResponse.Type

export class LocalRepresentationResolveFailure extends Schema.TaggedError<LocalRepresentationResolveFailure>()(
  "LocalRepresentationResolveFailure",
  {
    schemaVersion: Schema.Literal(1),
    reason: Schema.Literals(["application-binding", "artifact-store"])
  }
) {}
