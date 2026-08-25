import {
  Id,
  proposeAddFrame,
  type ArtifactRepresentation,
  type CanvasCommandBatch,
  type FrameId,
  type LiveRepresentation
} from "@crit/domain"
import { Effect } from "effect"
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

export type SnapshotRunState =
  | { readonly _tag: "idle" }
  | { readonly _tag: "capturing" }
  | { readonly _tag: "failed" }

const idleState: SnapshotRunState = { _tag: "idle" }
const capturingState: SnapshotRunState = { _tag: "capturing" }
const failedState: SnapshotRunState = { _tag: "failed" }

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
    if (stateRef.current._tag === "capturing") return
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
