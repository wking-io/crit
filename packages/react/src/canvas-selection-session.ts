import type { CanvasId } from "@crit/domain"

import {
  getSessionPreference,
  removeSessionPreference,
  setSessionPreference
} from "./browser-session.js"
import { CanvasSelection } from "./canvas-selection.js"

export const getCanvasSelectionSession = (args: {
  readonly canvasId: CanvasId
}) =>
  getSessionPreference({
    canvasId: args.canvasId,
    name: "selection",
    schema: CanvasSelection.schema
  })

export const setCanvasSelectionSession = (args: {
  readonly canvasId: CanvasId
  readonly selection: ReturnType<typeof CanvasSelection.make>
}) =>
  setSessionPreference({
    canvasId: args.canvasId,
    name: "selection",
    schema: CanvasSelection.schema,
    value: args.selection
  })

export const removeCanvasSelectionSession = (args: {
  readonly canvasId: CanvasId
}) =>
  removeSessionPreference({
    canvasId: args.canvasId,
    name: "selection"
  })
