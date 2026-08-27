import type { CanvasId } from "@crit/domain"
import {
  ReplicaBoard,
  ReplicaSession,
  useCanvasPresence,
  useReplicaSession,
  type FrameRepresentationResolver,
  type FrameSnapshotter,
  type ReplicaSessionPorts,
  type ReplicaSessionRun
} from "@crit/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Match } from "effect"
import { useState, type ReactElement } from "react"

export interface CritHostProps {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly resolver: FrameRepresentationResolver
  readonly snapshotter: FrameSnapshotter
  readonly run: ReplicaSessionRun
}

const idleAttend: ReplicaSessionPorts["attend"] = () => () => undefined

function CritHostSession({
  canvasId,
  ports,
  resolver,
  run,
  snapshotter
}: CritHostProps): ReactElement {
  const { onCameraChange, onSelectionChange, session, submit } = useReplicaSession({
    canvasId,
    ports,
    run
  })
  const presence = useCanvasPresence({
    attend: ReplicaSession.$is("ready")(session) ? ports.attend : idleAttend,
    canvasId
  })
  return Match.value(session).pipe(Match.tagsExhaustive({
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
  }))
}

export function CritHost(props: CritHostProps): ReactElement {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <CritHostSession {...props} />
    </QueryClientProvider>
  )
}
