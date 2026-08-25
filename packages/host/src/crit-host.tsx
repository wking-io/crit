import type {
  PresenceAttendFailure
} from "@crit/client"
import type { CanvasId } from "@crit/domain"
import {
  ReplicaBoard,
  usePresence,
  useReplicaSession,
  type FrameRepresentationResolver,
  type FrameSnapshotter,
  type PresencePorts,
  type PresenceRun,
  type ReplicaSession,
  type ReplicaSessionPorts,
  type ReplicaSessionRun
} from "@crit/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Match } from "effect"
import { useState, type ReactElement } from "react"

export interface CritHostProps {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly presencePorts: PresencePorts<PresenceAttendFailure>
  readonly presenceRun: PresenceRun
  readonly resolver: FrameRepresentationResolver
  readonly snapshotter: FrameSnapshotter
  readonly run: ReplicaSessionRun
}

function CritHostBoard({
  canvasId,
  onCameraChange,
  onSelectionChange,
  presencePorts,
  presenceRun,
  resolver,
  session,
  snapshotter,
  submit
}: {
  readonly canvasId: CanvasId
  readonly onCameraChange: Parameters<typeof ReplicaBoard>[0]["onCameraChange"]
  readonly onSelectionChange: Parameters<typeof ReplicaBoard>[0]["onSelectionChange"]
  readonly presencePorts: PresencePorts<PresenceAttendFailure>
  readonly presenceRun: PresenceRun
  readonly resolver: FrameRepresentationResolver
  readonly session: Extract<ReplicaSession, { readonly _tag: "ready" }>
  readonly snapshotter: FrameSnapshotter
  readonly submit: ReturnType<typeof useReplicaSession>["submit"]
}): ReactElement {
  const presence = usePresence({
    canvasId,
    ports: presencePorts,
    run: presenceRun
  })
  return (
    <ReplicaBoard
      camera={session.camera}
      onCameraChange={onCameraChange}
      onSelectionChange={onSelectionChange}
      onSubmit={(commands) => {
        void submit(commands)
      }}
      presence={presence}
      resolver={resolver}
      selection={session.selection}
      snapshotter={snapshotter}
      view={session.view}
    />
  )
}

function CritHostSession({
  canvasId,
  ports,
  presencePorts,
  presenceRun,
  resolver,
  run,
  snapshotter
}: CritHostProps): ReactElement {
  const { onCameraChange, onSelectionChange, session, submit } = useReplicaSession({
    canvasId,
    ports,
    run
  })
  return Match.value(session).pipe(Match.tagsExhaustive({
    loading: () => <p role="status">Connecting to Crit…</p>,
    ready: (readySession) => (
      <CritHostBoard
        canvasId={canvasId}
        onCameraChange={onCameraChange}
        onSelectionChange={onSelectionChange}
        presencePorts={presencePorts}
        presenceRun={presenceRun}
        resolver={resolver}
        session={readySession}
        snapshotter={snapshotter}
        submit={submit}
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
