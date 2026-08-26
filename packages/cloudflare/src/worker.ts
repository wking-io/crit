import { AuthorityModel, CreateCanvas } from "@crit/authority"
import {
  AccessPersonEmail,
  AuthSubject,
  IsoTimestamp,
  PersonEmail,
  PersonPrincipal,
  PersonSnapshot,
  type CanvasId,
  type CanvasTitle
} from "@crit/domain"
import {
  decodeRegisterDeploymentWire,
  decodeShareCanvasWire,
  encodeAccessAuthenticatedPersonWire,
  encodeCanvasSharedWire,
  parseRemoteAuthorityPath,
  remoteCanvasCollectionPath,
  type RegisterDeploymentWire
} from "@crit/protocol"
import { Effect, Exit, Option, Schema } from "effect"

import { readAccessEmail } from "./access.js"
import {
  CanvasDurableObject,
  testClockCancelPath,
  testClockPath
} from "./canvas-object.js"
import { registerControlDeployment } from "./deployments.js"
import { handleLedgerRequest } from "./ledger-http.js"

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
  schemaVersion: Schema.Literal(1),
  person: Schema.Struct({ email: PersonEmail })
})

const emptyResponse = (status: number) => new Response(null, { status })

const canvasSharedResponse = (
  canvasId: CanvasId,
  title: CanvasTitle
) => new Response(JSON.stringify(encodeCanvasSharedWire({
  kind: "canvas-shared",
  schemaVersion: 1,
  canvasId,
  title
})), {
  status: 200,
  headers: { "content-type": "application/json" }
})

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
  const invocation = AuthorityModel.personInvocation({ principal })
  const stub = env.CANVASES.get(env.CANVASES.idFromName(share.canvasId))
  const created = await stub.create(CreateCanvas.make({
    canvasId: share.canvasId,
    title: share.title
  }), invocation)
  if (created._tag === "success") {
    return canvasSharedResponse(
      created.value.projection.canvasId,
      created.value.projection.title
    )
  }
  if (
    created._tag !== "failure" ||
    created.error._tag !== "canvasAlreadyExists"
  ) {
    return emptyResponse(500)
  }
  const opened = await stub.open()
  return opened._tag === "success"
    ? canvasSharedResponse(
      opened.value.projection.canvasId,
      opened.value.projection.title
    )
    : emptyResponse(500)
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
    if (url.pathname === "/deployments") return registerDeployment(request, env)
    if (url.pathname === "/identity") return readIdentity(request)
    if (url.pathname === remoteCanvasCollectionPath) {
      return request.method === "POST"
        ? shareCanvas(request, env)
        : emptyResponse(405)
    }
    const ledger = parseRemoteAuthorityPath(url.pathname)
    if (ledger !== undefined) return handleLedgerRequest(request, env, ledger)
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith(testClockCancelPath)
    ) {
      return cancelTestClock(url.pathname.slice(testClockCancelPath.length))
    }
    if (request.method === "POST" && url.pathname.startsWith(testClockPath)) {
      return advanceTestClock(url)
    }
    return emptyResponse(404)
  }
}

export { CanvasDurableObject }
export default worker
