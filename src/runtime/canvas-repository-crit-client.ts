import { Effect } from "effect"

import {
  CritClient,
  CritClientUnavailable
} from "../session/crit-client.js"
import type { CanvasRepository } from "./canvas-repository.js"
import type { AgentActivityStore } from "./agent-activity.js"
import type { SnapshotService } from "./snapshot-service.js"

export interface CanvasRepositoryCritClientOptions {
  readonly currentAuthor: CritClient["Service"]["currentAuthor"]
  readonly snapshotFrame?: SnapshotService["Service"]["snapshotFrame"]
  readonly loadAgentActivities?: AgentActivityStore["Service"]["read"]
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
      ),
    ...(options.snapshotFrame === undefined
      ? {}
      : {
          snapshot: (id: string, frameId: string) =>
            options.snapshotFrame!(id, frameId)
        }),
    ...(options.loadAgentActivities === undefined
      ? {}
      : {
          activities: (id: string) =>
            options.loadAgentActivities!(id).pipe(
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
  }
}

export const CanvasRepositoryCritClient = { make } as const
