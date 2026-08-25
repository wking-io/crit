import { ApplicationRouteRepresentation, ArtifactRepresentation, Id } from "@crit/domain"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  LocalRepresentationCaptureRequest,
  LocalRepresentationJsonResponse,
  LocalRepresentationResolveRequest
} from "../src/index.js"
import {
  ApplicationUnavailableRenderPlan,
  ArtifactUnavailableRenderPlan,
  IframeRenderPlan
} from "../src/runtime.js"

const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  Schema.decodeUnknownSync(schema)(Schema.encodeSync(schema)(value))

describe("local representation HTTP schemas", () => {
  const representation = ApplicationRouteRepresentation.make({
    applicationId: Id.application("application_http_schema"),
    route: "/preview"
  })

  it("round-trips a bounded request", () => {
    const request = LocalRepresentationResolveRequest.make({
      _tag: "resolve-representation",
      schemaVersion: 1,
      representation
    })
    expect(roundTrip(LocalRepresentationResolveRequest, request)).toEqual(request)
  })

  it("round-trips a live capture request", () => {
    const request = LocalRepresentationCaptureRequest.make({
      _tag: "capture-representation",
      schemaVersion: 1,
      representation
    })
    expect(roundTrip(LocalRepresentationCaptureRequest, request)).toEqual(request)
  })

  it("round-trips every JSON response variant", () => {
    const iframe = IframeRenderPlan.make({
      representation,
      url: "https://example.com/preview"
    })
    const unavailable = ApplicationUnavailableRenderPlan.make({
      reason: "application-unbound",
      representation
    })
    const artifactUnavailable = ArtifactUnavailableRenderPlan.make({
      reason: "artifact-not-found",
      representation: ArtifactRepresentation.make({
        artifactId: Id.artifact("artifact_http_schema"),
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      })
    })
    expect(roundTrip(LocalRepresentationJsonResponse, iframe)).toEqual(iframe)
    expect(roundTrip(LocalRepresentationJsonResponse, unavailable)).toEqual(unavailable)
    expect(roundTrip(LocalRepresentationJsonResponse, artifactUnavailable)).toEqual(artifactUnavailable)
  })
})
