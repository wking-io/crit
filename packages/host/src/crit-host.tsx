import type { CanvasId } from "@crit/domain"
import {
  ReplicaBoard,
  useReplicaSession,
  type FrameRepresentationResolver,
  type ReplicaSessionPorts,
  type ReplicaSessionRun
} from "@crit/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Match } from "effect"
import { useState, type ReactElement } from "react"

import { NewFrameForm } from "./new-frame-form.js"

export interface CritHostProps {
  readonly canvasId: CanvasId
  readonly ports: ReplicaSessionPorts
  readonly resolver: FrameRepresentationResolver
  readonly run: ReplicaSessionRun
}

function CritHostSession({ canvasId, ports, resolver, run }: CritHostProps): ReactElement {
  const { onCameraChange, onSelectionChange, session, submit } = useReplicaSession({
    canvasId,
    ports,
    run
  })
  return Match.value(session).pipe(Match.tagsExhaustive({
    loading: () => <p role="status">Connecting to Crit…</p>,
    ready: ({ camera, selection, view }) => (
      <>
        <NewFrameForm
          frameCount={view.projection.frames.length}
          submit={submit}
        />
        <ReplicaBoard
          camera={camera}
          onCameraChange={onCameraChange}
          onSelectionChange={onSelectionChange}
          resolver={resolver}
          selection={selection}
          view={view}
        />
      </>
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
