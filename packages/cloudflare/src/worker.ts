import { AuthorityModel, CreateCanvas } from "@crit/authority"
import {
  AccessPersonEmail,
  AuthSubject,
  EmailAddress,
  PersonEmail,
  PersonPrincipal,
  PersonSnapshot,
  type CanvasId,
  type CanvasTitle,
  type IsoTimestamp
} from "@crit/domain"
import {
  decodeShareCanvasWire,
  encodeAccessAuthenticatedPersonWire,
  encodeCanvasSharedWire
} from "@crit/protocol"
import { Effect, Exit, Option, Schema } from "effect"

import {
  CanvasDurableObject,
  testClockCancelPath,
  testClockPath
} from "./canvas-object.js"

const testClocks = new Map<string, Effect.Effect<IsoTimestamp>>()
const runningClocks = new Map<string, string>()
const canceledClocks = new Set<string>()

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
  const address = Schema.decodeUnknownOption(EmailAddress)(
    request.headers.get("Cf-Access-Authenticated-User-Email")
  )
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
    created.error._tag !== "canvas-already-exists"
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

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/identity") {
      if (request.method !== "GET") {
        return new Response(null, { status: 405 })
      }
      const address = Schema.decodeUnknownOption(EmailAddress)(
        request.headers.get("Cf-Access-Authenticated-User-Email")
      )
      if (Option.isNone(address)) {
        return new Response(null, { status: 401 })
      }
      const body = encodeAccessAuthenticatedPersonWire({
        kind: "access-authenticated-person",
        schemaVersion: 1,
        address: address.value
      })
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }
      })
    }
    if (url.pathname === "/canvases") {
      return request.method === "POST"
        ? shareCanvas(request, env)
        : emptyResponse(405)
    }
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith(testClockCancelPath)
    ) {
      const requestId = url.pathname.slice(testClockCancelPath.length)
      if (runningClocks.has(requestId)) {
        canceledClocks.add(requestId)
        while (runningClocks.has(requestId)) {
          await scheduler.wait(1)
        }
      }
      return new Response(null, { status: 204 })
    }
    if (request.method !== "POST" || !url.pathname.startsWith(testClockPath)) {
      return new Response(null, { status: 404 })
    }
    const [encodedClockId, requestId] = url.pathname
      .slice(testClockPath.length)
      .split("/")
    if (encodedClockId === undefined || requestId === undefined) {
      return new Response(null, { status: 404 })
    }
    const testClockId = decodeURIComponent(encodedClockId)
    const clock = testClocks.get(testClockId)
    if (clock === undefined) {
      return new Response(null, { status: 404 })
    }
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
        : new Response(null, { status: 500 })
    } finally {
      runningClocks.delete(requestId)
      canceledClocks.delete(requestId)
    }
  }
}

export { CanvasDurableObject }
export default worker
