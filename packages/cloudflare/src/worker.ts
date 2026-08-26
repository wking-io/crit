import { AuthorityModel, CreateCanvas, type PersonInvocation } from "@crit/authority"
import {
  AccessPersonEmail,
  AuthSubject,
  IsoTimestamp,
  PersonEmail,
  PersonPrincipal,
  PersonSnapshot
} from "@crit/domain"
import {
  decodeRegisterDeploymentWire,
  decodeShareCanvasWire,
  encodeAccessAuthenticatedPersonWire,
  encodeCanvasDirectoryWire,
  encodeCanvasSharedWire,
  hostedApplicationResolvePath,
  parseArtifactPath,
  parseRemoteAuthorityPath,
  remoteCanvasCollectionPath,
  ShareDigestMismatch,
  type RegisterDeploymentWire
} from "@crit/protocol"
import { Effect, Exit, Option, Schema } from "effect"

import { readAccessEmail } from "./access.js"
import { handleArtifactRequest } from "./artifact-http.js"
import {
  CanvasDurableObject,
  testClockCancelPath,
  testClockPath
} from "./canvas-object.js"
import { registerControlDeployment } from "./deployments.js"
import { handleHostedApplicationResolve } from "./hosted-representation.js"
import { handleLedgerRequest } from "./ledger-http.js"
import { isDocumentRequest, isHostDocumentPath, serveShell } from "./shell.js"
import {
  compareShareReceipt,
  insertShareReceipt,
  listCanvasDirectory,
  lookupShareReceipt,
  ShareReceiptMismatch,
  ShareReceiptRequest,
  type ComparedShareReceipt,
  type ShareReceiptRow
} from "./shares.js"

const testClocks = new Map<string, Effect.Effect<IsoTimestamp>>()
const runningClocks = new Map<string, string>()
const canceledClocks = new Set<string>()

const isDeploymentAuthorized = (
  request: Request,
  env: Cloudflare.Env
) => env.CRIT_DEPLOY_TOKEN.trim().length > 0
  && request.headers.get("Authorization") === `Bearer ${env.CRIT_DEPLOY_TOKEN}`

interface RegisteredTestClock {
  readonly id: string
  readonly close: () => void
}

const SharePersonEmailProbe = Schema.Struct({
  kind: Schema.Literal("share-canvas"),
  person: Schema.Struct({ email: PersonEmail })
})

const emptyResponse = (status: number) => new Response(null, { status })

const encodedJson = <A>(
  status: number,
  schema: Schema.Schema<A>,
  value: A
) => new Response(JSON.stringify(Schema.encodeSync(schema)(value)), {
  status,
  headers: { "content-type": "application/json" }
})

const canvasSharedResponse = (receipt: ShareReceiptRow) => new Response(
  JSON.stringify(encodeCanvasSharedWire({
    kind: "canvas-shared",
    schemaVersion: 2,
    canvasId: receipt.canvasId,
    title: receipt.title,
    shareId: receipt.shareId,
    importId: receipt.importId,
    projectionDigest: receipt.projectionDigest,
    workspaceId: receipt.workspaceId,
    personId: receipt.personId
  })),
  {
    status: 200,
    headers: { "content-type": "application/json" }
  }
)

const comparedShareResponse = (
  compared: ComparedShareReceipt
) => {
  if (compared._tag === "match") return canvasSharedResponse(compared.receipt)
  if (compared._tag === "digestMismatch") {
    return encodedJson(409, ShareDigestMismatch, compared.mismatch)
  }
  return encodedJson(409, ShareReceiptMismatch, compared.mismatch)
}

const openOrCreateRemoteCanvas = async (
  env: Cloudflare.Env,
  requested: ShareReceiptRequest,
  invocation: PersonInvocation
): Promise<Response> => {
  const stub = env.CANVASES.get(env.CANVASES.idFromName(requested.canvasId))
  const created = await stub.create(CreateCanvas.make({
    canvasId: requested.canvasId,
    title: requested.title
  }), invocation)
  if (
    created._tag === "failure" &&
    created.error._tag !== "canvasAlreadyExists"
  ) {
    return emptyResponse(500)
  }
  if (created._tag !== "success") {
    const opened = await stub.open()
    if (opened._tag !== "success") return emptyResponse(500)
  }
  try {
    return canvasSharedResponse(await insertShareReceipt(env, requested))
  } catch {
    const raced = await lookupShareReceipt(env, requested.shareId)
    return raced === undefined
      ? emptyResponse(500)
      : comparedShareResponse(compareShareReceipt(raced, requested))
  }
}

const shareCanvas = async (
  request: Request,
  env: Cloudflare.Env
): Promise<Response> => {
  const address = readAccessEmail(request)
  if (Option.isNone(address)) return emptyResponse(401)

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return emptyResponse(400)
  }

  let share: ReturnType<typeof decodeShareCanvasWire>
  try {
    share = decodeShareCanvasWire(input)
  } catch {
    const probe = Schema.decodeUnknownOption(
      SharePersonEmailProbe,
      { onExcessProperty: "ignore" }
    )(input)
    return Option.isSome(probe) && probe.value.person.email._tag !== "access"
      ? emptyResponse(401)
      : emptyResponse(400)
  }
  if (share.person.email.address !== address.value) {
    return emptyResponse(401)
  }

  const requested = ShareReceiptRequest.make({
    shareId: share.shareId,
    importId: share.importId,
    canvasId: share.canvasId,
    personId: share.person.personId,
    projectionDigest: share.projectionDigest,
    title: share.title
  })
  const existing = await lookupShareReceipt(env, share.shareId)
  if (existing !== undefined) {
    return comparedShareResponse(compareShareReceipt(existing, requested))
  }

  const person = PersonSnapshot.make({
    personId: share.person.personId,
    displayName: share.person.displayName,
    email: AccessPersonEmail.make({
      address: share.person.email.address
    })
  })
  const principal = PersonPrincipal.make({
    subject: Schema.decodeUnknownSync(AuthSubject)(`access|${address.value}`),
    person
  })
  return openOrCreateRemoteCanvas(
    env,
    requested,
    AuthorityModel.personInvocation({ principal })
  )
}

export const registerTestClock = (
  now: Effect.Effect<IsoTimestamp>
): RegisteredTestClock => {
  const id = crypto.randomUUID()
  testClocks.set(id, now)
  return {
    id,
    close: () => {
      testClocks.delete(id)
      for (const [requestId, testClockId] of runningClocks) {
        if (testClockId === id) canceledClocks.add(requestId)
      }
    }
  }
}

const registerDeployment = async (
  request: Request,
  env: Cloudflare.Env
): Promise<Response> => {
  if (request.method !== "POST") return emptyResponse(405)
  if (!isDeploymentAuthorized(request, env)) return emptyResponse(401)
  let registration: RegisterDeploymentWire
  try {
    registration = decodeRegisterDeploymentWire(await request.json())
  } catch {
    return emptyResponse(400)
  }
  try {
    const body = await registerControlDeployment(registration, env)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  } catch {
    return emptyResponse(500)
  }
}

const readCanvasDirectory = async (
  request: Request,
  env: Cloudflare.Env
): Promise<Response> => {
  if (request.method !== "GET") return emptyResponse(405)
  const address = readAccessEmail(request)
  if (Option.isNone(address)) return emptyResponse(401)
  return new Response(JSON.stringify(encodeCanvasDirectoryWire({
    kind: "canvas-directory",
    schemaVersion: 1,
    canvases: await listCanvasDirectory(env)
  })), {
    status: 200,
    headers: { "content-type": "application/json" }
  })
}

const readIdentity = (request: Request): Response => {
  if (request.method !== "GET") return emptyResponse(405)
  const address = readAccessEmail(request)
  if (Option.isNone(address)) return emptyResponse(401)
  const body = encodeAccessAuthenticatedPersonWire({
    kind: "access-authenticated-person",
    schemaVersion: 1,
    address: address.value
  })
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" }
  })
}

const cancelTestClock = async (requestId: string): Promise<Response> => {
  if (runningClocks.has(requestId)) {
    canceledClocks.add(requestId)
    while (runningClocks.has(requestId)) {
      await scheduler.wait(1)
    }
  }
  return emptyResponse(204)
}

const advanceTestClock = async (url: URL): Promise<Response> => {
  const [encodedClockId, requestId] = url.pathname
    .slice(testClockPath.length)
    .split("/")
  if (encodedClockId === undefined || requestId === undefined) {
    return emptyResponse(404)
  }
  const testClockId = decodeURIComponent(encodedClockId)
  const clock = testClocks.get(testClockId)
  if (clock === undefined) return emptyResponse(404)
  runningClocks.set(requestId, testClockId)
  const canceled = Effect.promise(async () => {
    while (!canceledClocks.has(requestId)) {
      await scheduler.wait(1)
    }
  }).pipe(Effect.andThen(Effect.die("Test clock request canceled")))
  try {
    const exit = await Effect.runPromise(Effect.exit(
      Effect.raceFirst(clock, canceled)
    ))
    return Exit.isSuccess(exit)
      ? new Response(exit.value)
      : emptyResponse(500)
  } finally {
    runningClocks.delete(requestId)
    canceledClocks.delete(requestId)
  }
}

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (isDocumentRequest(request) && isHostDocumentPath(url.pathname)) {
      return serveShell(request, env)
    }
    if (url.pathname === "/deployments") return registerDeployment(request, env)
    if (url.pathname === hostedApplicationResolvePath) {
      return handleHostedApplicationResolve(request, env)
    }
    if (url.pathname === "/identity") return readIdentity(request)
    if (url.pathname === remoteCanvasCollectionPath) {
      if (request.method === "GET") return readCanvasDirectory(request, env)
      return request.method === "POST"
        ? shareCanvas(request, env)
        : emptyResponse(405)
    }
    const ledger = parseRemoteAuthorityPath(url.pathname)
    if (ledger !== undefined) return handleLedgerRequest(request, env, ledger)
    const artifactId = parseArtifactPath(url.pathname)
    if (artifactId !== undefined) return handleArtifactRequest(request, env, artifactId)
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith(testClockCancelPath)
    ) {
      return cancelTestClock(url.pathname.slice(testClockCancelPath.length))
    }
    if (request.method === "POST" && url.pathname.startsWith(testClockPath)) {
      return advanceTestClock(url)
    }
    return serveShell(request, env)
  }
}

export { CanvasDurableObject }
export default worker
