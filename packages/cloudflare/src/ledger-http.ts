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
  ChangePageSchema,
  ChangeProtocol,
  decodeSubmitCanvasChangeWire,
  parseChangesAfterSearch,
  RemoteAuthorityRoute,
  SubmitChangeReceiptSchema
} from "@crit/protocol"
import { Match, Result, Schema } from "effect"

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

const encodedJson = <S extends Schema.ConstraintEncoder<unknown>>(
  status: number,
  schema: S,
  value: S["Type"]
) => jsonResponse(status, JSON.stringify(Schema.encodeUnknownSync(schema)(value)))

const encodeSubmitFailure = (error: SubmitCanvasChangeFailure) =>
  Match.value(error).pipe(Match.tagsExhaustive({
    canvasNotFound: (notFound) => encodedJson(404, CanvasNotFound, notFound),
    cursorNotFound: (notFound) => encodedJson(404, CursorNotFound, notFound),
    changeIdReused: (reused) => encodedJson(409, ChangeIdReused, reused),
    changeRejected: (rejected) => encodedJson(409, ChangeRejected, rejected)
  }))

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
  return Match.value(opened).pipe(
    Match.tag("success", ({ value }) => encodedJson(200, AuthorityView, value)),
    Match.tag("failure", ({ error }) => encodedJson(404, CanvasNotFound, error)),
    Match.orElse(() => emptyResponse(500))
  )
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
  return Match.value(page).pipe(
    Match.tag("success", ({ value }) =>
      jsonResponse(200, JSON.stringify(ChangeProtocol.page.encode(
        Schema.decodeUnknownSync(ChangePageSchema)(value)
      )))),
    Match.tag("failure", ({ error }) => Match.value(error).pipe(
      Match.tag("canvasNotFound", (notFound) => encodedJson(404, CanvasNotFound, notFound)),
      Match.orElse((notFound) => encodedJson(404, CursorNotFound, notFound))
    )),
    Match.orElse(() => emptyResponse(500))
  )
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
      Match.value(decoded.failure).pipe(
        Match.tag("envelopeInvalid", () => emptyResponse(400)),
        Match.orElse((failure) => protocolFailureResponse(failure))
      ),
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
  return Match.value(submitted).pipe(
    Match.tag("success", ({ value }) => respondWithCallerCookie(
      jsonResponse(200, JSON.stringify(ChangeProtocol.receipt.encode(
        Schema.decodeUnknownSync(SubmitChangeReceiptSchema)(value)
      ))),
      request,
      resolved
    )),
    Match.tag("failure", ({ error }) =>
      respondWithCallerCookie(encodeSubmitFailure(error), request, resolved)),
    Match.orElse(() => respondWithCallerCookie(emptyResponse(500), request, resolved))
  )
}

export const handleLedgerRequest = async (
  request: Request,
  env: Cloudflare.Env,
  route: RemoteAuthorityRoute
): Promise<Response> => {
  const resolved = resolveCallerIdentity(request)
  if (RemoteAuthorityRoute.$is("canvas")(route)) {
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
