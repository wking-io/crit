import { Effect } from "effect"

import {
  CritClientUnavailable,
  type CritClientShape
} from "../session/crit-client.js"
import type { CanvasRepositoryShape } from "./canvas-repository.js"
import type { AgentActivityStoreShape } from "./agent-activity.js"
import type { SnapshotServiceShape } from "./snapshot-service.js"

export interface CanvasRepositoryCritClientOptions {
  readonly currentAuthor: CritClientShape["currentAuthor"]
  readonly snapshotFrame?: SnapshotServiceShape["snapshotFrame"]
  readonly loadAgentActivities?: AgentActivityStoreShape["read"]
}

const make = (
  documents: CanvasRepositoryShape,
  options: CanvasRepositoryCritClientOptions
): CritClientShape => {
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
