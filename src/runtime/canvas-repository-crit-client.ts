import { Effect } from "effect"

import {
  CritActivityClient,
  CritClient,
  CritSnapshotClient,
  CritClientUnavailable
} from "../session/crit-client.js"
import type { CanvasRepository } from "./canvas-repository.js"
import type { AgentActivityStore } from "./agent-activity.js"
import type { SnapshotService } from "./snapshot-service.js"

export interface CanvasRepositoryCritClientOptions {
  readonly currentAuthor: CritClient["Service"]["currentAuthor"]
}

const make = (
  documents: CanvasRepository["Service"],
  options: CanvasRepositoryCritClientOptions
): CritClient["Service"] => {
  return {
    currentAuthor: options.currentAuthor,
    load: (id) => documents.load(id),
    apply: (id, commands) =>
      documents.apply(id, commands).pipe(
        Effect.map((mutation) => mutation.document)
      )
  }
}

export const CanvasRepositoryCritClient = { make } as const

const makeSnapshotClient = (
  snapshotFrame: SnapshotService["Service"]["snapshotFrame"]
): CritSnapshotClient["Service"] => ({
  snapshot: snapshotFrame
})

export const CanvasRepositoryCritSnapshotClient = {
  make: makeSnapshotClient
} as const

const makeActivityClient = (
  loadAgentActivities: AgentActivityStore["Service"]["read"]
): CritActivityClient["Service"] => ({
  activities: (id) =>
    loadAgentActivities(id).pipe(
      Effect.mapError(
        (cause) =>
          new CritClientUnavailable({
            operation: "activity",
            id,
            detail: cause.detail
          })
      )
    )
})

export const CanvasRepositoryCritActivityClient = {
  make: makeActivityClient
} as const
