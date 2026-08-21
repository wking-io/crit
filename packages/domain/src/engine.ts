import type { CanvasProjection, CanvasTitle } from "./canvas.js"
import type {
  CanvasChange,
  CanvasCommand,
  CanvasCommandBatch
} from "./command.js"
import type { CanvasId, ChangeId } from "./ids.js"

interface CanvasMismatch {
  readonly _tag: "canvas-mismatch"
  readonly expectedCanvasId: CanvasId
  readonly actualCanvasId: CanvasId
}

interface CanvasTitleMismatch {
  readonly _tag: "canvas-title-mismatch"
  readonly commandIndex: number
  readonly expectedTitle: CanvasTitle
  readonly actualTitle: CanvasTitle
}

export type CanvasChangeFailure = CanvasMismatch | CanvasTitleMismatch

interface AppliedCanvasChange {
  readonly _tag: "applied"
  readonly projection: CanvasProjection
}

interface RejectedCanvasChange {
  readonly _tag: "rejected"
  readonly failure: CanvasChangeFailure
}

export type CanvasChangeResult = AppliedCanvasChange | RejectedCanvasChange

interface DuplicateReplayChange {
  readonly _tag: "duplicate-change"
  readonly changeId: ChangeId
  readonly firstIndex: number
  readonly currentIndex: number
}

interface RejectedReplayChange {
  readonly _tag: "change-rejected"
  readonly changeIndex: number
  readonly changeId: ChangeId
  readonly failure: CanvasChangeFailure
}

export type CanvasReplayFailure = DuplicateReplayChange | RejectedReplayChange

interface ReplayedCanvas {
  readonly _tag: "replayed"
  readonly projection: CanvasProjection
}

interface FailedCanvasReplay {
  readonly _tag: "replay-failed"
  readonly failure: CanvasReplayFailure
}

export type CanvasReplayResult = ReplayedCanvas | FailedCanvasReplay

const applyCommand = (
  projection: CanvasProjection,
  command: CanvasCommand,
  commandIndex: number
): CanvasChangeResult => {
  switch (command._tag) {
    case "rename-canvas":
      if (projection.title !== command.expectedTitle) {
        return {
          _tag: "rejected",
          failure: {
            _tag: "canvas-title-mismatch",
            commandIndex,
            expectedTitle: command.expectedTitle,
            actualTitle: projection.title
          }
        }
      }
      if (projection.title === command.title) {
        return { _tag: "applied", projection }
      }
      return {
        _tag: "applied",
        projection: { ...projection, title: command.title }
      }
  }
}

const applyCommands = (
  initial: CanvasProjection,
  commands: CanvasCommandBatch
): CanvasChangeResult => {
  let projection = initial
  for (const [commandIndex, command] of commands.entries()) {
    const result = applyCommand(projection, command, commandIndex)
    if (result._tag === "rejected") return result
    projection = result.projection
  }
  return { _tag: "applied", projection }
}

const apply = (
  projection: CanvasProjection,
  change: CanvasChange
): CanvasChangeResult => {
  if (projection.canvasId !== change.canvasId) {
    return {
      _tag: "rejected",
      failure: {
        _tag: "canvas-mismatch",
        expectedCanvasId: projection.canvasId,
        actualCanvasId: change.canvasId
      }
    }
  }
  return applyCommands(projection, change.commands)
}

const replay = (
  initial: CanvasProjection,
  changes: readonly CanvasChange[]
): CanvasReplayResult => {
  let projection = initial
  const firstIndexByChangeId = new Map<ChangeId, number>()

  for (const [changeIndex, change] of changes.entries()) {
    const firstIndex = firstIndexByChangeId.get(change.changeId)
    if (firstIndex !== undefined) {
      return {
        _tag: "replay-failed",
        failure: {
          _tag: "duplicate-change",
          changeId: change.changeId,
          firstIndex,
          currentIndex: changeIndex
        }
      }
    }

    const result = apply(projection, change)
    if (result._tag === "rejected") {
      return {
        _tag: "replay-failed",
        failure: {
          _tag: "change-rejected",
          changeIndex,
          changeId: change.changeId,
          failure: result.failure
        }
      }
    }

    firstIndexByChangeId.set(change.changeId, changeIndex)
    projection = result.projection
  }

  return { _tag: "replayed", projection }
}

export const CanvasEngine = { apply, replay }
