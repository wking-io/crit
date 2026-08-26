import { ArtifactRepresentation, type ArtifactId } from "@crit/domain"
import {
  ArtifactContentCorrupt,
  ArtifactDigestConflict,
  encodeArtifactStoredWire,
  parseArtifactDigestSearch
} from "@crit/protocol"
import { Effect, Option, Schema } from "effect"

import { readAccessEmail } from "./access.js"
import { R2ArtifactStore } from "./r2-artifact-store.js"

const emptyResponse = (status: number) => new Response(null, { status })

const encodedJson = <A>(
  status: number,
  schema: Schema.Schema<A>,
  value: A
) => new Response(JSON.stringify(Schema.encodeSync(schema)(value)), {
  status,
  headers: { "content-type": "application/json" }
})

export const handleArtifactRequest = async (
  request: Request,
  env: Cloudflare.Env,
  artifactId: ArtifactId
): Promise<Response> => {
  const address = readAccessEmail(request)
  if (Option.isNone(address)) return emptyResponse(401)
  const store = R2ArtifactStore.make(env.ARTIFACTS)
  if (request.method === "PUT") {
    const bytes = new Uint8Array(await request.arrayBuffer())
    const outcome = await Effect.runPromise(Effect.result(store.put({ artifactId, bytes })))
    if (outcome._tag === "Success") {
      return new Response(JSON.stringify(encodeArtifactStoredWire({
        kind: "artifact-stored",
        schemaVersion: 1,
        artifactId: outcome.success.artifactId,
        digest: outcome.success.digest
      })), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    }
    if (outcome.failure._tag === "ArtifactConflict") {
      return encodedJson(409, ArtifactDigestConflict, ArtifactDigestConflict.make({
        artifactId: outcome.failure.artifactId,
        storedDigest: outcome.failure.storedDigest,
        suppliedDigest: outcome.failure.suppliedDigest
      }))
    }
    return emptyResponse(500)
  }
  if (request.method === "GET") {
    const digest = parseArtifactDigestSearch(new URL(request.url).search)
    if (digest === undefined) return emptyResponse(400)
    const artifact = ArtifactRepresentation.make({ artifactId, digest })
    const outcome = await Effect.runPromise(Effect.result(store.read(artifact)))
    if (outcome._tag === "Success") {
      return new Response(outcome.success, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "private, max-age=31536000, immutable"
        }
      })
    }
    if (outcome.failure._tag === "ArtifactNotFound") return emptyResponse(404)
    if (outcome.failure._tag === "ArtifactCorrupt") {
      return encodedJson(409, ArtifactContentCorrupt, ArtifactContentCorrupt.make({
        artifactId: outcome.failure.artifact.artifactId,
        expectedDigest: outcome.failure.artifact.digest,
        actualDigest: outcome.failure.actualDigest
      }))
    }
    return emptyResponse(500)
  }
  return emptyResponse(405)
}
