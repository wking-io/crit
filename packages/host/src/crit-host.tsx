import type { CanvasCommandBatch, CanvasId } from "@crit/domain"
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
import { useCallback, type ReactElement } from "react"

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
  const { chrome, onCameraChange, onSelectionChange, session, submit } =
    useReplicaSession({
      canvasId,
      ports
    })
  const presence = useCanvasPresence({
    attend: ReplicaSession.$is("ready")(session) ? ports.attend : idleAttend,
    canvasId
  })
  const onSubmit = useCallback((commands: CanvasCommandBatch) => {
    void submit(commands)
  }, [submit])
  return (
    <div className="crit-host">
      {Match.value(session).pipe(Match.tagsExhaustive({
        loading: () => <p role="status">Connecting to Crit…</p>,
        ready: ({ connection, notice, view }) => (
          <ReplicaBoard
            camera={chrome.camera}
            connection={connection}
            notice={notice}
            onCameraChange={onCameraChange}
            onSelectionChange={onSelectionChange}
            onSubmit={onSubmit}
            presence={presence}
            resolver={resolver}
            selection={chrome.selection}
            snapshotter={snapshotter}
            view={view}
          />
        ),
        unavailable: ({ reason }) => <p role="alert">{reason}</p>
      }))}
    </div>
  )
}
