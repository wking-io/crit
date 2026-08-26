import { AuthorityModel, CreateCanvas } from "@crit/authority"
import {
  AccessPersonEmail,
  ApplicationId,
  AuthSubject,
  DeploymentChannel,
  DeploymentId,
  DeploymentUrl,
  EmailAddress,
  Id,
  IsoTimestamp,
  PersonEmail,
  PersonPrincipal,
  PersonSnapshot,
  SourceRevision,
  type CanvasId,
  type CanvasTitle
} from "@crit/domain"
import {
  decodeRegisterDeploymentWire,
  decodeShareCanvasWire,
  encodeAccessAuthenticatedPersonWire,
  encodeCanvasSharedWire,
  encodeDeploymentRegisteredWire,
  type RegisterDeploymentWire
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

const deploymentTable = `
CREATE TABLE IF NOT EXISTS deployments (
  application_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  url TEXT NOT NULL,
  source_revision TEXT,
  expires_at TEXT,
  PRIMARY KEY (application_id, channel)
) STRICT;
`

const DeploymentRow = Schema.Struct({
  deploymentId: DeploymentId,
  applicationId: ApplicationId,
  channel: DeploymentChannel,
  url: DeploymentUrl,
  sourceRevision: Schema.NullOr(SourceRevision),
  expiresAt: Schema.NullOr(IsoTimestamp)
})

interface DeploymentDetails {
  sourceRevision?: SourceRevision
  expiresAt?: IsoTimestamp
}

const isDeploymentAuthorized = (
  request: Request,
  env: Cloudflare.Env
) => env.CRIT_DEPLOY_TOKEN.trim().length > 0
  && request.headers.get("Authorization") === `Bearer ${env.CRIT_DEPLOY_TOKEN}`

const registerDeployment = async(
  registration: RegisterDeploymentWire,
  env: Cloudflare.Env
) => {
  await env.CONTROL.prepare(deploymentTable).run()
  const deploymentId = Id.deployment(
    `deployment_${crypto.randomUUID().replaceAll("-", "")}`
  )
  const result = await env.CONTROL.prepare(`
    INSERT INTO deployments (
      application_id,
      channel,
      deployment_id,
      url,
      source_revision,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (application_id, channel) DO UPDATE SET
      url = excluded.url,
      source_revision = excluded.source_revision,
      expires_at = excluded.expires_at
    RETURNING
      deployment_id AS deploymentId,
      application_id AS applicationId,
      channel,
      url,
      source_revision AS sourceRevision,
      expires_at AS expiresAt
  `).bind(
    registration.applicationId,
    registration.channel,
    deploymentId,
    registration.url,
    registration.sourceRevision ?? null,
    registration.expiresAt ?? null
  ).first()
  const row = Schema.decodeUnknownSync(DeploymentRow)(result)
  const details: DeploymentDetails = {}
  if (row.sourceRevision !== null) {
    details.sourceRevision = row.sourceRevision
  }
  if (row.expiresAt !== null) {
    details.expiresAt = row.expiresAt
  }
  return encodeDeploymentRegisteredWire({
    kind: "deployment-registered",
    schemaVersion: 1,
    deploymentId: row.deploymentId,
    applicationId: row.applicationId,
    channel: row.channel,
    url: row.url,
    ...details
  })
}

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
    if (url.pathname === "/deployments") {
      if (request.method !== "POST") {
        return new Response(null, { status: 405 })
      }
      if (!isDeploymentAuthorized(request, env)) {
        return new Response(null, { status: 401 })
      }
      let registration: RegisterDeploymentWire
      try {
        registration = decodeRegisterDeploymentWire(await request.json())
      } catch {
        return new Response(null, { status: 400 })
      }
      try {
        const body = await registerDeployment(registration, env)
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      } catch {
        return new Response(null, { status: 500 })
      }
    }
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
