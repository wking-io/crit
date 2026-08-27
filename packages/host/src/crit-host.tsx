import type { CanvasId } from "@crit/domain"
import {
  ReplicaBoard,
  ReplicaSession,
  useCanvasPresence,
  useReplicaSession,
  type FrameRepresentationResolver,
  type FrameSnapshotter,
  type ReplicaSessionPorts
} from "@crit/react"
import { Match } from "effect"
import { type ReactElement } from "react"

export interface CritHostProps {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly resolver: FrameRepresentationResolver
  readonly snapshotter: FrameSnapshotter
}

const idleAttend: ReplicaSessionPorts["attend"] = () => () => undefined

export function CritHost({
  canvasId,
  ports,
  resolver,
  snapshotter
}: CritHostProps): ReactElement {
  const { onCameraChange, onSelectionChange, session, submit } = useReplicaSession({
    canvasId,
    ports
  })
  const presence = useCanvasPresence({
    attend: ReplicaSession.$is("ready")(session) ? ports.attend : idleAttend,
    canvasId
  })
  return (
    <div className="crit-host">
      {Match.value(session).pipe(Match.tagsExhaustive({
        loading: () => <p role="status">Connecting to Crit…</p>,
        ready: ({ camera, connection, notice, selection, view }) => (
          <ReplicaBoard
            camera={camera}
            connection={connection}
            notice={notice}
            onCameraChange={onCameraChange}
            onSelectionChange={onSelectionChange}
            onSubmit={(commands) => {
              void submit(commands)
            }}
            presence={presence}
            resolver={resolver}
            selection={selection}
            snapshotter={snapshotter}
            view={view}
          />
        ),
        unavailable: ({ reason }) => <p role="alert">{reason}</p>
      }))}
    </div>
  )
}
