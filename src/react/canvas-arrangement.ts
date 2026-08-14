import { Effect, Schema } from "effect"

export const CanvasArrangementItem = Schema.Struct({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number
})
export type CanvasArrangementItem = typeof CanvasArrangementItem.Type

export const CanvasAlignment = Schema.Literals([
  "left",
  "horizontal-center",
  "right",
  "top",
  "vertical-center",
  "bottom"
])
export type CanvasAlignment = typeof CanvasAlignment.Type

export const CanvasArrangementOperation = Schema.Union([
  Schema.TaggedStruct("Align", { alignment: CanvasAlignment }),
  Schema.TaggedStruct("Distribute", {
    axis: Schema.Literals(["horizontal", "vertical"])
  }),
  Schema.TaggedStruct("ArrangeGrid", {})
])
export type CanvasArrangementOperation = typeof CanvasArrangementOperation.Type

export const CanvasArrangementRequest = Schema.Struct({
  operation: CanvasArrangementOperation,
  items: Schema.Array(CanvasArrangementItem)
})
export type CanvasArrangementRequest = typeof CanvasArrangementRequest.Type

export const CanvasArrangementMove = Schema.Struct({
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number
})
export type CanvasArrangementMove = typeof CanvasArrangementMove.Type

export const CanvasArrangementPlan = Schema.Struct({
  moves: Schema.Array(CanvasArrangementMove)
})
export type CanvasArrangementPlan = typeof CanvasArrangementPlan.Type

export class CanvasArrangementUnavailable extends Schema.TaggedError<CanvasArrangementUnavailable>()(
  "CanvasArrangementUnavailable",
  {
    reason: Schema.Literals(["insufficient-items", "duplicate-item"]),
    detail: Schema.String
  }
) {}

type Bounds = {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
  readonly centerX: number
  readonly centerY: number
}

const boundsOf = (items: ReadonlyArray<CanvasArrangementItem>): Bounds => {
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const right = Math.max(...items.map((item) => item.x + item.width))
  const bottom = Math.max(...items.map((item) => item.y + item.height))
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  }
}

const spatialOrder = (
  items: ReadonlyArray<CanvasArrangementItem>
): ReadonlyArray<CanvasArrangementItem> => [...items].sort((left, right) =>
  left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)
)

const compareOnAxis = (
  axis: "horizontal" | "vertical"
) => (left: CanvasArrangementItem, right: CanvasArrangementItem) =>
  axis === "horizontal"
    ? left.x - right.x || left.y - right.y || left.id.localeCompare(right.id)
    : left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)

const align = (
  alignment: CanvasAlignment,
  items: ReadonlyArray<CanvasArrangementItem>
): ReadonlyArray<CanvasArrangementMove> => {
  const bounds = boundsOf(items)
  return items.map((item) => ({
    id: item.id,
    x: alignment === "left"
      ? bounds.left
      : alignment === "horizontal-center"
        ? bounds.centerX - item.width / 2
        : alignment === "right"
          ? bounds.right - item.width
          : item.x,
    y: alignment === "top"
      ? bounds.top
      : alignment === "vertical-center"
        ? bounds.centerY - item.height / 2
        : alignment === "bottom"
          ? bounds.bottom - item.height
          : item.y
  }))
}

const distribute = (
  axis: "horizontal" | "vertical",
  items: ReadonlyArray<CanvasArrangementItem>
): ReadonlyArray<CanvasArrangementMove> => {
  const ordered = [...items].sort(compareOnAxis(axis))
  const first = ordered[0]!
  const last = ordered.at(-1)!
  const start = axis === "horizontal" ? first.x : first.y
  const end = axis === "horizontal"
    ? last.x + last.width
    : last.y + last.height
  const occupied = ordered.reduce(
    (total, item) => total + (axis === "horizontal" ? item.width : item.height),
    0
  )
  const gap = (end - start - occupied) / (ordered.length - 1)
  let cursor = start
  return ordered.map((item) => {
    const move = {
      id: item.id,
      x: axis === "horizontal" ? cursor : item.x,
      y: axis === "vertical" ? cursor : item.y
    }
    cursor += (axis === "horizontal" ? item.width : item.height) + gap
    return move
  })
}

type GridShape = {
  readonly columns: number
  readonly rows: number
  readonly score: number
}

const gridShape = (
  items: ReadonlyArray<CanvasArrangementItem>,
  bounds: Bounds
): GridShape => {
  const averageWidth = items.reduce((sum, item) => sum + item.width, 0) / items.length
  const averageHeight = items.reduce((sum, item) => sum + item.height, 0) / items.length
  const itemAspect = averageWidth / Math.max(averageHeight, Number.EPSILON)
  const selectionAspect = bounds.width / Math.max(bounds.height, Number.EPSILON)
  const candidates = Array.from({ length: items.length }, (_, index) => {
    const columns = index + 1
    const rows = Math.ceil(items.length / columns)
    const layoutAspect = (columns / rows) * itemAspect
    const emptyCells = columns * rows - items.length
    const score = Math.abs(Math.log(
      Math.max(layoutAspect, Number.EPSILON) /
      Math.max(selectionAspect, Number.EPSILON)
    )) + emptyCells / items.length * .15
    return { columns, rows, score }
  })
  return candidates.sort((left, right) =>
    left.score - right.score ||
    (left.columns === items.length ? 1 : 0) - (right.columns === items.length ? 1 : 0) ||
    right.columns - left.columns
  )[0]!
}

const arrangeGrid = (
  items: ReadonlyArray<CanvasArrangementItem>
): ReadonlyArray<CanvasArrangementMove> => {
  const ordered = spatialOrder(items)
  const bounds = boundsOf(items)
  const { columns, rows } = gridShape(ordered, bounds)
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...ordered
      .filter((_, index) => index % columns === column)
      .map((item) => item.width))
  )
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...ordered
      .slice(row * columns, (row + 1) * columns)
      .map((item) => item.height))
  )
  const occupiedWidth = columnWidths.reduce((sum, width) => sum + width, 0)
  const occupiedHeight = rowHeights.reduce((sum, height) => sum + height, 0)
  const layoutWidth = Math.max(bounds.width, occupiedWidth)
  const layoutHeight = Math.max(bounds.height, occupiedHeight)
  const horizontalGap = columns === 1
    ? 0
    : (layoutWidth - occupiedWidth) / (columns - 1)
  const verticalGap = rows === 1
    ? 0
    : (layoutHeight - occupiedHeight) / (rows - 1)
  const left = bounds.centerX - layoutWidth / 2
  const top = bounds.centerY - layoutHeight / 2
  const columnStarts: Array<number> = []
  const rowStarts: Array<number> = []
  let x = left
  for (const width of columnWidths) {
    columnStarts.push(x)
    x += width + horizontalGap
  }
  let y = top
  for (const height of rowHeights) {
    rowStarts.push(y)
    y += height + verticalGap
  }
  return ordered.map((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      id: item.id,
      x: columnStarts[column]! + (columnWidths[column]! - item.width) / 2,
      y: rowStarts[row]! + (rowHeights[row]! - item.height) / 2
    }
  })
}

const requiredItemCount = (operation: CanvasArrangementOperation) =>
  operation._tag === "Distribute" ? 3 : 2

const makePlan = (
  request: CanvasArrangementRequest
): Effect.Effect<CanvasArrangementPlan, CanvasArrangementUnavailable> => {
  const minimum = requiredItemCount(request.operation)
  if (request.items.length < minimum) {
    return Effect.fail(new CanvasArrangementUnavailable({
      reason: "insufficient-items",
      detail: `${request.operation._tag} requires at least ${minimum} selected items.`
    }))
  }
  if (new Set(request.items.map((item) => item.id)).size !== request.items.length) {
    return Effect.fail(new CanvasArrangementUnavailable({
      reason: "duplicate-item",
      detail: "Arrangement items must have unique IDs."
    }))
  }
  const moves = request.operation._tag === "Align"
    ? align(request.operation.alignment, request.items)
    : request.operation._tag === "Distribute"
      ? distribute(request.operation.axis, request.items)
      : arrangeGrid(request.items)
  return Effect.succeed(Schema.decodeUnknownSync(CanvasArrangementPlan)({ moves }))
}

export const CanvasArrangement = {
  plan: makePlan
} as const
