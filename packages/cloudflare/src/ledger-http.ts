import {
  AuthorityModel,
  AuthorityView,
  CanvasNotFound,
  ChangeIdReused,
  ChangeRejected,
  CursorNotFound,
  type SubmitCanvasChangeFailure
} from "@crit/authority"
import { type CanvasId } from "@crit/domain"
import {
  ChangeProtocol,
  decodeSubmitCanvasChangeWire,
  parseChangesAfterSearch,
  type RemoteAuthorityRoute
} from "@crit/protocol"
import { Result, Schema } from "effect"

import {
  callerMatchesInvocation,
  resolveCallerIdentity,
  respondWithCallerCookie
} from "./caller.js"
import { protocolFailureResponse } from "./protocol-http.js"

const emptyResponse = (status: number) => new Response(null, { status })

const jsonResponse = (status: number, body: string) => new Response(body, {
  status,
  headers: { "content-type": "application/json" }
})

const encodedJson = <A>(
  status: number,
  schema: Schema.Schema<A>,
  value: A
) => jsonResponse(status, JSON.stringify(Schema.encodeSync(schema)(value)))

const encodeSubmitFailure = (error: SubmitCanvasChangeFailure) => {
  switch (error._tag) {
    case "canvasNotFound":
      return encodedJson(404, CanvasNotFound, error)
    case "cursorNotFound":
      return encodedJson(404, CursorNotFound, error)
    case "changeIdReused":
      return encodedJson(409, ChangeIdReused, error)
    case "changeRejected":
      return encodedJson(409, ChangeRejected, error)
  }
}

const readJsonBody = async (request: Request): Promise<Schema.Json | undefined> => {
  try {
    return Schema.decodeUnknownSync(Schema.Json)(await request.json())
  } catch {
    return undefined
  }
}

const openCanvas = async (
  env: Cloudflare.Env,
  canvasId: CanvasId
): Promise<Response> => {
  const stub = env.CANVASES.get(env.CANVASES.idFromName(canvasId))
  const opened = await stub.open()
  if (opened._tag === "success") {
    return encodedJson(200, AuthorityView, opened.value)
  }
  if (opened._tag === "failure") {
    return encodedJson(404, CanvasNotFound, opened.error)
  }
  return emptyResponse(500)
}

const pullChanges = async (
  request: Request,
  env: Cloudflare.Env,
  canvasId: CanvasId
): Promise<Response> => {
  const query = parseChangesAfterSearch(new URL(request.url).search)
  if (query === undefined) return emptyResponse(400)
  const stub = env.CANVASES.get(env.CANVASES.idFromName(canvasId))
  const { canvasId: _canvasId, ...oneCanvasQuery } = AuthorityModel.changesAfter({
    canvasId,
    after: query.after,
    limit: AuthorityModel.pageLimit(query.limit)
  })
  const page = await stub.changesAfter(oneCanvasQuery)
  if (page._tag === "success") {
    return jsonResponse(200, JSON.stringify(ChangeProtocol.page.encode(page.value)))
  }
  if (page._tag === "failure" && page.error._tag === "canvasNotFound") {
    return encodedJson(404, CanvasNotFound, page.error)
  }
  if (page._tag === "failure") {
    return encodedJson(404, CursorNotFound, page.error)
  }
  return emptyResponse(500)
}

const pushChange = async (
  request: Request,
  env: Cloudflare.Env,
  canvasId: CanvasId,
  resolved: ReturnType<typeof resolveCallerIdentity>
): Promise<Response> => {
  const caller = resolved.caller
  const input = await readJsonBody(request)
  if (input === undefined) {
    return respondWithCallerCookie(emptyResponse(400), request, resolved)
  }
  const decoded = decodeSubmitCanvasChangeWire(input)
  if (Result.isFailure(decoded)) {
    return respondWithCallerCookie(
      decoded.failure._tag === "envelopeInvalid"
        ? emptyResponse(400)
        : protocolFailureResponse(decoded.failure),
      request,
      resolved
    )
  }
  if (decoded.success.proposal.canvasId !== canvasId) {
    return respondWithCallerCookie(emptyResponse(400), request, resolved)
  }
  if (!callerMatchesInvocation(caller, decoded.success.invocation)) {
    return respondWithCallerCookie(emptyResponse(401), request, resolved)
  }
  const { canvasId: _canvasId, ...proposal } = decoded.success.proposal
  const stub = env.CANVASES.get(env.CANVASES.idFromName(canvasId))
  const submitted = await stub.submit(proposal, decoded.success.invocation)
  if (submitted._tag === "success") {
    return respondWithCallerCookie(
      jsonResponse(200, JSON.stringify(ChangeProtocol.receipt.encode(submitted.value))),
      request,
      resolved
    )
  }
  if (submitted._tag === "failure") {
    return respondWithCallerCookie(encodeSubmitFailure(submitted.error), request, resolved)
  }
  return respondWithCallerCookie(emptyResponse(500), request, resolved)
}

export const handleLedgerRequest = async (
  request: Request,
  env: Cloudflare.Env,
  route: RemoteAuthorityRoute
): Promise<Response> => {
  const resolved = resolveCallerIdentity(request)
  if (route._tag === "canvas") {
    const response = request.method === "GET"
      ? await openCanvas(env, route.canvasId)
      : emptyResponse(405)
    return respondWithCallerCookie(response, request, resolved)
  }
  if (request.method === "GET") {
    return respondWithCallerCookie(
      await pullChanges(request, env, route.canvasId),
      request,
      resolved
    )
  }
  if (request.method === "POST") {
    return pushChange(request, env, route.canvasId, resolved)
  }
  return respondWithCallerCookie(emptyResponse(405), request, resolved)
}
