import type { CanvasId } from "@crit/domain"
import { Option } from "effect"

import { readAccessEmail } from "./access.js"

const emptyResponse = (status: number) => new Response(null, { status })

const isWebSocketUpgrade = (request: Request): boolean =>
  request.headers.get("Upgrade")?.toLowerCase() === "websocket"

export const handlePresenceRequest = async (
  request: Request,
  env: Cloudflare.Env,
  canvasId: CanvasId
): Promise<Response> => {
  if (request.method !== "GET") return emptyResponse(405)
  if (!isWebSocketUpgrade(request)) return emptyResponse(400)
  if (Option.isNone(readAccessEmail(request))) return emptyResponse(401)
  const stub = env.CANVASES.get(env.CANVASES.idFromName(canvasId))
  return stub.fetch(request)
}
