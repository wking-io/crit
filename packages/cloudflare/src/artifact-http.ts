import { ArtifactRepresentation, type ArtifactId } from "@crit/domain"
import {
  ArtifactContentCorrupt,
  ArtifactDigestConflict,
  encodeArtifactStoredWire,
  parseArtifactDigestSearch
} from "@crit/protocol"
import { Effect, Match, Result, Schema } from "effect"

import { resolveCallerIdentity, respondWithCallerCookie } from "./caller.js"
import { R2ArtifactStore } from "./r2-artifact-store.js"

const emptyResponse = (status: number) => new Response(null, { status })

const encodedJson = <S extends Schema.ConstraintEncoder<unknown>>(
  status: number,
  schema: S,
  value: S["Type"]
) => new Response(JSON.stringify(Schema.encodeUnknownSync(schema)(value)), {
  status,
  headers: { "content-type": "application/json" }
})

export const handleArtifactRequest = async (
  request: Request,
  env: Cloudflare.Env,
  artifactId: ArtifactId
): Promise<Response> => {
  const resolved = resolveCallerIdentity(request)
  const respond = (response: Response) =>
    respondWithCallerCookie(response, request, resolved)
  const store = R2ArtifactStore.make(env.ARTIFACTS)
  if (request.method === "PUT") {
    const bytes = new Uint8Array(await request.arrayBuffer())
    const outcome = await Effect.runPromise(Effect.result(store.put({ artifactId, bytes })))
    if (Result.isSuccess(outcome)) {
      return respond(new Response(JSON.stringify(encodeArtifactStoredWire({
        kind: "artifact-stored",
        schemaVersion: 1,
        artifactId: outcome.success.artifactId,
        digest: outcome.success.digest
      })), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
    }
    return Match.value(outcome.failure).pipe(
      Match.tag("ArtifactConflict", (conflict) => respond(encodedJson(409, ArtifactDigestConflict, ArtifactDigestConflict.make({
        artifactId: conflict.artifactId,
        storedDigest: conflict.storedDigest,
        suppliedDigest: conflict.suppliedDigest
      })))),
      Match.orElse(() => respond(emptyResponse(500)))
    )
  }
  if (request.method === "GET") {
    const digest = parseArtifactDigestSearch(new URL(request.url).search)
    if (digest === undefined) return respond(emptyResponse(400))
    const artifact = ArtifactRepresentation.make({ artifactId, digest })
    const outcome = await Effect.runPromise(Effect.result(store.read(artifact)))
    if (Result.isSuccess(outcome)) {
      return respond(new Response(outcome.success, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "private, max-age=31536000, immutable"
        }
      }))
    }
    return Match.value(outcome.failure).pipe(
      Match.tag("ArtifactNotFound", () => respond(emptyResponse(404))),
      Match.tag("ArtifactCorrupt", (corrupt) => respond(encodedJson(409, ArtifactContentCorrupt, ArtifactContentCorrupt.make({
        artifactId: corrupt.artifact.artifactId,
        expectedDigest: corrupt.artifact.digest,
        actualDigest: corrupt.actualDigest
      })))),
      Match.orElse(() => respond(emptyResponse(500)))
    )
  }
  return respond(emptyResponse(405))
}
