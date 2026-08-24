import {
  AddFrameCommand,
  AuthoredText,
  Geometry,
  type HttpUrl,
  type RepresentationRef,
  type RootedRoute
} from "@crit/domain"
import { Match, Option, Result, Schema } from "effect"

export const DEFAULT_FRAME_WIDTH = 1200
export const DEFAULT_FRAME_HEIGHT = 800
export const FRAME_GUTTER = 40

export const nextFrameGeometry = (input: {
  readonly frameCount: number
  readonly width: number
  readonly height: number
}): typeof Geometry.Type =>
  Geometry.make({
    x: (input.frameCount % 3) * (input.width + FRAME_GUTTER),
    y: Math.floor(input.frameCount / 3) * (input.height + FRAME_GUTTER),
    width: input.width,
    height: input.height
  })

export const resolveFrameGeometry = (input: {
  readonly frameCount: number
  readonly x: Option.Option<number>
  readonly y: Option.Option<number>
  readonly width: Option.Option<number>
  readonly height: Option.Option<number>
}): Result.Result<typeof Geometry.Type, string> => {
  if (Option.isSome(input.x) !== Option.isSome(input.y)) {
    return Result.fail("x and y must be set together")
  }
  const width = Option.getOrElse(input.width, () => DEFAULT_FRAME_WIDTH)
  const height = Option.getOrElse(input.height, () => DEFAULT_FRAME_HEIGHT)
  const placed = Option.isSome(input.x) && Option.isSome(input.y)
    ? { x: input.x.value, y: input.y.value, width, height }
    : nextFrameGeometry({ frameCount: input.frameCount, width, height })
  return Option.match(Schema.decodeUnknownOption(Geometry)(placed), {
    onNone: () => Result.fail("Invalid geometry"),
    onSome: Result.succeed
  })
}

export const inferredFrameTitle = (route: RootedRoute): AuthoredText => {
  const pathname = route.split("?")[0] ?? route
  const segments = pathname.split("/").filter((segment) => segment.length > 0)
  return Schema.decodeUnknownSync(AuthoredText)(
    segments[segments.length - 1] ?? "Untitled frame"
  )
}

export const inferredWebUrlTitle = (url: HttpUrl): AuthoredText => {
  const parsed = new URL(url)
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0)
  const last = segments[segments.length - 1]
  if (last !== undefined) {
    let label = last
    try {
      label = decodeURIComponent(last)
    } catch {
      label = last
    }
    const decoded = Schema.decodeUnknownOption(AuthoredText)(label)
    if (Option.isSome(decoded)) return decoded.value
  }
  return Schema.decodeUnknownSync(AuthoredText)(parsed.hostname)
}

export const inferredTitle = (representation: RepresentationRef): AuthoredText =>
  Match.value(representation).pipe(
    Match.when({ _tag: "application-route" }, ({ route }) => inferredFrameTitle(route)),
    Match.when({ _tag: "web-url" }, ({ url }) => inferredWebUrlTitle(url)),
    Match.when({ _tag: "artifact" }, () => Schema.decodeUnknownSync(AuthoredText)("Untitled frame")),
    Match.exhaustive
  )

export const frameSourceLabel = (representation: RepresentationRef): string =>
  Match.value(representation).pipe(
    Match.when({ _tag: "application-route" }, ({ route }) => route),
    Match.when({ _tag: "web-url" }, ({ url }) => url),
    Match.when({ _tag: "artifact" }, ({ artifactId }) => artifactId),
    Match.exhaustive
  )

export const frameCommand = (input: {
  readonly frameId: typeof AddFrameCommand.Type["frameId"]
  readonly title: AuthoredText
  readonly representation: RepresentationRef
  readonly geometry: typeof Geometry.Type
}): typeof AddFrameCommand.Type =>
  AddFrameCommand.make({
    frameId: input.frameId,
    title: input.title,
    representation: input.representation,
    status: "in-progress",
    geometry: input.geometry
  })
