import {
  CanvasCommand,
  type CanvasCommand as CanvasCommandValue,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasGeometry,
  type CanvasNote
} from "../core/index.js"
import {
  resizeGeometry,
  type ResizeHandlePosition
} from "./canvas-selection.js"

export type CanvasInteractionKind =
  | { readonly type: "move" }
  | { readonly type: "resize"; readonly handle: ResizeHandlePosition }

export type CanvasInteractionDelta = {
  readonly x: number
  readonly y: number
}

export type CanvasInteractionPreview = Readonly<
  Record<string, CanvasGeometry>
>

export interface CanvasInteraction {
  readonly affectedIds: ReadonlyArray<string>
  readonly preview: (delta: CanvasInteractionDelta) => CanvasInteractionPreview
  readonly finish: (delta: CanvasInteractionDelta) => ReadonlyArray<CanvasCommandValue>
}

export type CanvasInteractionPointer = {
  readonly pointerId: number
  readonly currentTarget: {
    readonly setPointerCapture: (pointerId: number) => void
  }
}

export const captureCanvasInteractionPointer = (
  event: CanvasInteractionPointer
): void => {
  event.currentTarget.setPointerCapture(event.pointerId)
}

const itemFrom = (
  document: CanvasDocument,
  itemId: string
): CanvasFrame | CanvasNote => {
  const item =
    document.frames.find((frame) => frame.id === itemId) ??
    document.notes.find((note) => note.id === itemId)
  if (item === undefined) throw new TypeError(`Canvas item not found: ${itemId}`)
  return item
}

const isFrame = (item: CanvasFrame | CanvasNote): item is CanvasFrame =>
  "url" in item

export const beginCanvasInteraction = (input: {
  readonly document: CanvasDocument
  readonly itemId: string
  readonly startGeometry: CanvasGeometry
  readonly kind: CanvasInteractionKind
  readonly geometryOverrides?: CanvasInteractionPreview
}): CanvasInteraction => {
  const item = itemFrom(input.document, input.itemId)
  const attached = isFrame(item)
    ? input.document.notes.filter((note) => note.attachedTo === item.id)
    : []
  const affectedIds = [item.id, ...attached.map((note) => note.id)]
  const geometryAt = (delta: CanvasInteractionDelta) =>
    input.kind.type === "move"
      ? {
          ...input.startGeometry,
          x: input.startGeometry.x + delta.x,
          y: input.startGeometry.y + delta.y
        }
      : resizeGeometry(
          input.startGeometry,
          input.kind.handle,
          delta.x,
          delta.y
        )

  const preview = (delta: CanvasInteractionDelta) => {
    const geometry = geometryAt(delta)
    const deltaX = geometry.x - input.startGeometry.x
    const deltaY = geometry.y - input.startGeometry.y
    return {
      [item.id]: geometry,
      ...Object.fromEntries(
        attached.map((note) => [
          note.id,
          {
            ...note.geometry,
            x: note.geometry.x + deltaX,
            y: note.geometry.y + deltaY
          }
        ])
      )
    }
  }

  const finishMove = (
    geometry: CanvasGeometry
  ): ReadonlyArray<CanvasCommandValue> => {
    if (isFrame(item)) {
      return [CanvasCommand.moveFrame({ id: item.id, x: geometry.x, y: geometry.y })]
    }
    const centerX = geometry.x + geometry.width / 2
    const centerY = geometry.y + geometry.height / 2
    const parent = input.document.frames.find((frame) => {
      const bounds = input.geometryOverrides?.[frame.id] ?? frame.geometry
      return (
        centerX >= bounds.x &&
        centerX <= bounds.x + bounds.width &&
        centerY >= bounds.y &&
        centerY <= bounds.y + bounds.height
      )
    })
    const commands: Array<CanvasCommandValue> = [
      CanvasCommand.moveNote({ id: item.id, x: geometry.x, y: geometry.y })
    ]
    if (parent !== undefined && item.attachedTo !== parent.id) {
      commands.push(CanvasCommand.attachNote({ id: item.id, frameId: parent.id }))
    } else if (parent === undefined && item.attachedTo !== null) {
      commands.push(CanvasCommand.detachNote({ id: item.id }))
    }
    return commands
  }

  const finishResize = (
    geometry: CanvasGeometry
  ): ReadonlyArray<CanvasCommandValue> => {
    const commands: Array<CanvasCommandValue> = []
    if (isFrame(item) && item.display.heightMode === "fit-page") {
      commands.push(
        CanvasCommand.updateFrame({
          id: item.id,
          changes: { display: { heightMode: "viewport" } }
        })
      )
    }
    if (
      geometry.x !== input.startGeometry.x ||
      geometry.y !== input.startGeometry.y
    ) {
      commands.push(
        isFrame(item)
          ? CanvasCommand.moveFrame({ id: item.id, x: geometry.x, y: geometry.y })
          : CanvasCommand.moveNote({ id: item.id, x: geometry.x, y: geometry.y })
      )
    }
    commands.push(
      isFrame(item)
        ? CanvasCommand.resizeFrame({
            id: item.id,
            width: geometry.width,
            height: geometry.height
          })
        : CanvasCommand.resizeNote({
            id: item.id,
            width: geometry.width,
            height: geometry.height
          })
    )
    return commands
  }

  return {
    affectedIds,
    preview,
    finish: (delta) => {
      const geometry = geometryAt(delta)
      return input.kind.type === "move"
        ? finishMove(geometry)
        : finishResize(geometry)
    }
  }
}
