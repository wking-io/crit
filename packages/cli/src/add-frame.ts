import {
  AddFrameCommand,
  ApplicationRouteRepresentation,
  AuthoredText,
  Geometry,
  type ApplicationId,
  type FrameId,
  type RootedRoute
} from "@crit/domain"
import { Schema } from "effect"

export const nextFrameGeometry = (frameCount: number): typeof Geometry.Type =>
  Geometry.make({
    x: (frameCount % 3) * 1240,
    y: Math.floor(frameCount / 3) * 840,
    width: 1200,
    height: 800
  })

export const inferredFrameTitle = (route: RootedRoute): AuthoredText => {
  const pathname = route.split("?")[0] ?? route
  const segments = pathname.split("/").filter((segment) => segment.length > 0)
  return Schema.decodeUnknownSync(AuthoredText)(
    segments[segments.length - 1] ?? "Untitled frame"
  )
}

export const applicationFrameCommand = (input: {
  applicationId: ApplicationId
  route: RootedRoute
  title: AuthoredText
  frameId: FrameId
  geometry: typeof Geometry.Type
}): typeof AddFrameCommand.Type =>
  AddFrameCommand.make({
    frameId: input.frameId,
    title: input.title,
    representation: ApplicationRouteRepresentation.make({
      applicationId: input.applicationId,
      route: input.route
    }),
    status: "in-progress",
    geometry: input.geometry
  })
