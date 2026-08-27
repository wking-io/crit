import {
  DeploymentChannel,
  IsoTimestamp
} from "@crit/domain"
import {
  decodeHostedApplicationResolveRequest,
  decodeHostedApplicationResolveResponse,
  encodeHostedApplicationResolveResponse
} from "@crit/protocol"
import {
  ArtifactStore,
  DeploymentApplicationBindings,
  LiveContent,
  RepresentationRuntime,
  RepresentationRuntimeLive
} from "@crit/representations"
import { Crypto, Effect, Layer, Schema } from "effect"

import { resolveCallerIdentity, respondWithCallerCookie } from "./caller.js"
import { listControlDeployments } from "./deployments.js"
import { negotiateRequest, readJsonRequest } from "./protocol-http.js"

const review = Schema.decodeUnknownSync(DeploymentChannel)("review")

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

const inertCrypto = Layer.succeed(Crypto.Crypto, Crypto.make({
  randomBytes: (size) => new Uint8Array(size),
  digest: (_algorithm, bytes) => Effect.succeed(bytes)
}))

const emptyResponse = (status: number) => new Response(null, { status })

export const handleHostedApplicationResolve = async (
  request: Request,
  env: Cloudflare.Env
): Promise<Response> => {
  const resolved = resolveCallerIdentity(request)
  const respond = (response: Response) =>
    respondWithCallerCookie(response, request, resolved)
  if (request.method !== "POST") return respond(emptyResponse(405))

  const input = await readJsonRequest(request)
  if (input === undefined) return respond(emptyResponse(400))

  const rejected = negotiateRequest(input, {
    kind: "resolveApplicationRoute",
    schemaVersion: 1
  })
  if (rejected !== undefined) return respond(rejected)

  let decoded: ReturnType<typeof decodeHostedApplicationResolveRequest>
  try {
    decoded = decodeHostedApplicationResolveRequest(input)
  } catch {
    return respond(emptyResponse(400))
  }

  try {
    const deployments = await listControlDeployments(env)
    const now = Schema.decodeUnknownSync(IsoTimestamp)(new Date().toISOString())
    const dependencies = Layer.mergeAll(
      DeploymentApplicationBindings.layer({ deployments, channel: review, now }),
      inertArtifactStore,
      inertLiveContent,
      inertCrypto
    )
    const runtime = RepresentationRuntimeLive.pipe(Layer.provide(dependencies))
    const plan = await Effect.runPromise(Effect.gen(function*() {
      const service = yield* RepresentationRuntime
      return yield* service.resolve(decoded.representation)
    }).pipe(Effect.provide(runtime)))
    const response = decodeHostedApplicationResolveResponse(plan)
    return respond(new Response(
      JSON.stringify(encodeHostedApplicationResolveResponse(response)),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    ))
  } catch {
    return respond(emptyResponse(500))
  }
}
