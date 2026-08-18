import { Canvas, CanvasCommand, type CanvasDocument } from "@riff-refine/crit"
import { Effect } from "effect"

import {
  LAUNCH_CANVAS_ID,
  LAUNCH_FEATURES,
  LAUNCH_HERO,
  LAUNCH_NOTE,
  LAUNCH_OWNER,
  LAUNCH_SIGNUP
} from "./layout.js"

const placeFrame = (frame: {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly status: "approved" | "ready-for-review" | "in-progress"
  readonly geometry: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}) => [
  CanvasCommand.addFrame({
    id: frame.id,
    url: frame.url,
    title: frame.title,
    status: frame.status,
    provenance: { kind: "manifest", sourceId: frame.id }
  }),
  CanvasCommand.moveFrame({
    id: frame.id,
    x: frame.geometry.x,
    y: frame.geometry.y
  }),
  CanvasCommand.resizeFrame({
    id: frame.id,
    width: frame.geometry.width,
    height: frame.geometry.height
  })
]

export const launchSeedDocument = (): CanvasDocument => {
  const canvas = Canvas.create({
    id: LAUNCH_CANVAS_ID,
    title: "Crit",
    owner: { ...LAUNCH_OWNER }
  })
  Effect.runSync(
    Canvas.apply(
      canvas,
      ...placeFrame(LAUNCH_HERO),
      ...placeFrame(LAUNCH_FEATURES),
      ...placeFrame(LAUNCH_SIGNUP),
      CanvasCommand.addNote({
        id: LAUNCH_NOTE.id,
        text: LAUNCH_NOTE.text,
        author: { ...LAUNCH_OWNER },
        x: LAUNCH_NOTE.x,
        y: LAUNCH_NOTE.y,
        width: LAUNCH_NOTE.width,
        height: LAUNCH_NOTE.height,
        color: LAUNCH_NOTE.color
      })
    )
  )
  return Canvas.export(canvas)
}
