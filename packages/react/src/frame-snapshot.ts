import {
  Id,
  proposeAddFrame,
  type ArtifactRepresentation,
  type CanvasCommandBatch,
  type FrameId,
  type LiveRepresentation
} from "@crit/domain"
import { Data, Effect } from "effect"
import { useRef, useState } from "react"

import type {
  SnapshotRequest,
  SnapshotSource
} from "./review-actions.js"

export interface FrameSnapshotter {
  readonly capture: (
    representation: LiveRepresentation
  ) => Effect.Effect<ArtifactRepresentation, unknown>
}

export type SnapshotRunState = Data.TaggedEnum<{
  readonly idle: {}
  readonly capturing: {}
  readonly failed: {}
}>
export const SnapshotRunState = Data.taggedEnum<SnapshotRunState>()

const idleState = SnapshotRunState.idle()
const capturingState = SnapshotRunState.capturing()
const failedState = SnapshotRunState.failed()

const defaultMintFrameId = (): FrameId =>
  Id.frame(`frame_${crypto.randomUUID().replaceAll("-", "")}`)

const snapshotCommand = (
  source: SnapshotSource,
  artifact: ArtifactRepresentation,
  mintFrameId: () => FrameId
) => proposeAddFrame({
  frameId: mintFrameId(),
  title: source.title,
  representation: artifact,
  status: "in-progress",
  geometry: {
    ...source.geometry,
    x: source.geometry.x - source.geometry.width - 40
  }
})

const snapshotCommands = (
  snapshotter: FrameSnapshotter,
  request: SnapshotRequest,
  mintFrameId: () => FrameId
): Effect.Effect<CanvasCommandBatch, unknown> => Effect.gen(function*() {
  const [first, ...rest] = request
  const capture = (source: SnapshotSource) => snapshotter
    .capture(source.representation)
    .pipe(Effect.map((artifact) => snapshotCommand(source, artifact, mintFrameId)))
  const firstCommand = yield* capture(first)
  const restCommands = yield* Effect.forEach(rest, capture, { concurrency: 1 })
  return [firstCommand, ...restCommands]
})

export const useSnapshotRunner = ({
  mintFrameId = defaultMintFrameId,
  onSubmit,
  snapshotter
}: {
  readonly snapshotter: FrameSnapshotter
  readonly onSubmit: (commands: CanvasCommandBatch) => void
  readonly mintFrameId?: () => FrameId
}) => {
  const [state, setState] = useState<SnapshotRunState>(idleState)
  const stateRef = useRef<SnapshotRunState>(idleState)

  const begin = (request: SnapshotRequest): void => {
    if (SnapshotRunState.$is("capturing")(stateRef.current)) return
    stateRef.current = capturingState
    setState(capturingState)
    void Effect.runPromise(
      snapshotCommands(snapshotter, request, mintFrameId)
    ).then(
      (commands) => {
        stateRef.current = idleState
        setState(idleState)
        onSubmit(commands)
      },
      () => {
        stateRef.current = failedState
        setState(failedState)
      }
    )
  }

  return { begin, state }
}
