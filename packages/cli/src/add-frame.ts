import {
  AddFrameCommand,
  AuthoredText,
  Geometry,
  type RepresentationRef
} from "@crit/domain"
import { Match, Option, Result, Schema } from "effect"

export const DEFAULT_FRAME_WIDTH = 1200
export const DEFAULT_FRAME_HEIGHT = 800

export const resolveFrameGeometry = (input: {
  readonly x: number
  readonly y: number
  readonly width: Option.Option<number>
  readonly height: Option.Option<number>
}): Result.Result<typeof Geometry.Type, string> => {
  const width = Option.getOrElse(input.width, () => DEFAULT_FRAME_WIDTH)
  const height = Option.getOrElse(input.height, () => DEFAULT_FRAME_HEIGHT)
  return Option.match(Schema.decodeUnknownOption(Geometry)({
    x: input.x,
    y: input.y,
    width,
    height
  }), {
    onNone: () => Result.fail("Invalid geometry"),
    onSome: Result.succeed
  })
}

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
