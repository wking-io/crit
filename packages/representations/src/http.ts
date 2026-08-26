import {
  LiveRepresentation,
  RepresentationRef
} from "@crit/domain"
import { Schema } from "effect"

import {
  ApplicationUnavailableRenderPlan,
  ArtifactUnavailableRenderPlan,
  IframeRenderPlan
} from "./runtime.js"

export const localRepresentationResolvePath = "/api/v1/representations/resolve"
export const localRepresentationCapturePath = "/api/v1/representations/capture"

export const LocalRepresentationResolveRequest = Schema.TaggedStruct("resolveRepresentation", {
  schemaVersion: Schema.Literal(1),
  representation: RepresentationRef
})
export type LocalRepresentationResolveRequest = typeof LocalRepresentationResolveRequest.Type

export const LocalRepresentationCaptureRequest = Schema.TaggedStruct("captureRepresentation", {
  schemaVersion: Schema.Literal(1),
  representation: LiveRepresentation
})
export type LocalRepresentationCaptureRequest = typeof LocalRepresentationCaptureRequest.Type

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

export class LocalRepresentationCaptureFailure extends Schema.TaggedError<LocalRepresentationCaptureFailure>()(
  "LocalRepresentationCaptureFailure",
  {
    schemaVersion: Schema.Literal(1),
    reason: Schema.Literals([
      "source-unavailable",
      "source-unreachable",
      "application-binding",
      "artifact-store"
    ])
  }
) {}
