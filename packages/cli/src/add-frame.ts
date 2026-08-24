import {
  AddFrameCommand,
  ApplicationRouteRepresentation,
  AuthoredText,
  Geometry,
  RootedRoute,
  type ApplicationId,
  type FrameId
} from "@crit/domain"
import { Result, Schema } from "effect"

export const nextFrameGeometry = (frameCount: number): typeof Geometry.Type =>
  Geometry.make({
    x: (frameCount % 3) * 1240,
    y: Math.floor(frameCount / 3) * 840,
    width: 1200,
    height: 800
  })

const defaultFrameTitle = (route: string): string => {
  const pathname = route.split("?")[0] ?? route
  const segments = pathname.split("/").filter((segment) => segment.length > 0)
  return segments[segments.length - 1] ?? "Untitled frame"
}

const decodeOrReason = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
): Result.Result<S["Type"], { readonly reason: string }> => {
  const decoded = Schema.decodeUnknownResult(schema)(value)
  return Result.isSuccess(decoded)
    ? Result.succeed(decoded.success)
    : Result.fail({ reason: decoded.failure.message })
}

export const applicationFrameCommand = (input: {
  applicationId: ApplicationId
  route: string
  title: string
  frameId: FrameId
  geometry: typeof Geometry.Type
}): Result.Result<typeof AddFrameCommand.Type, { readonly reason: string }> => {
  const route = decodeOrReason(RootedRoute, input.route)
  if (Result.isFailure(route)) return Result.fail(route.failure)
  const title = decodeOrReason(
    AuthoredText,
    input.title.length === 0 ? defaultFrameTitle(route.success) : input.title
  )
  if (Result.isFailure(title)) return Result.fail(title.failure)
  const representation = decodeOrReason(ApplicationRouteRepresentation, {
    _tag: "application-route",
    applicationId: input.applicationId,
    route: route.success
  })
  if (Result.isFailure(representation)) return Result.fail(representation.failure)
  return decodeOrReason(AddFrameCommand, {
    _tag: "add-frame",
    frameId: input.frameId,
    title: title.success,
    representation: representation.success,
    status: "in-progress",
    geometry: input.geometry
  })
}
