import {
  AddFrameCommand,
  AuthoredText,
  Geometry,
  WebUrlRepresentation,
  type FrameId
} from "@crit/domain"
import { Result, Schema } from "effect"

const fallbackReason = "Enter a valid frame URL"

const fail = (reason: string): Result.Result<never, { readonly reason: string }> =>
  Result.fail({ reason })

const parseHref = (raw: string): Result.Result<URL, { readonly reason: string }> => {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return fail(fallbackReason)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(fallbackReason)
  }
  parsed.hostname = parsed.hostname.toLowerCase()
  return Result.succeed(parsed)
}

const representationReason = (parsed: URL): string => {
  if (parsed.username !== "" || parsed.password !== "") {
    return "A frame URL cannot contain credentials."
  }
  const hostname = parsed.hostname
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "A frame URL cannot use localhost."
  }
  return fallbackReason
}

const inferredTitle = (parsed: URL): string =>
  parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.hostname

export const nextFrameGeometry = (frameCount: number): Geometry =>
  Schema.decodeUnknownSync(Geometry)({
    x: (frameCount % 3) * 1240,
    y: Math.floor(frameCount / 3) * 840,
    width: 1200,
    height: 800
  })

export const newFrameCommand = (input: {
  readonly url: string
  readonly title: string
  readonly frameId: FrameId
  readonly geometry: Geometry
}): Result.Result<typeof AddFrameCommand.Type, { readonly reason: string }> => {
  const parsed = parseHref(input.url)
  if (Result.isFailure(parsed)) return fail(parsed.failure.reason)

  const representation = Schema.decodeUnknownResult(WebUrlRepresentation)({
    _tag: "web-url",
    url: parsed.success.href
  })
  if (Result.isFailure(representation)) {
    return fail(representationReason(parsed.success))
  }

  const trimmedTitle = input.title.trim()
  const title = Schema.decodeUnknownResult(AuthoredText)(
    trimmedTitle === ""
      ? inferredTitle(parsed.success) || "Untitled frame"
      : trimmedTitle
  )
  if (Result.isFailure(title)) return fail(fallbackReason)

  return Schema.decodeUnknownResult(AddFrameCommand)({
    _tag: "add-frame",
    frameId: input.frameId,
    title: title.success,
    representation: representation.success,
    status: "in-progress",
    geometry: input.geometry
  }).pipe(Result.mapError(() => ({ reason: fallbackReason })))
}
