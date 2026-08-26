import { createHash } from "node:crypto"

import { CanvasProjection, Sha256Digest } from "@crit/domain"
import { Schema } from "effect"

export const projectionDigest = (
  projection: CanvasProjection
): Sha256Digest => {
  const encoded = Schema.encodeSync(CanvasProjection)(projection)
  const digest = createHash("sha256")
    .update(JSON.stringify(encoded))
    .digest("hex")
  return Schema.decodeUnknownSync(Sha256Digest)(`sha256:${digest}`)
}
