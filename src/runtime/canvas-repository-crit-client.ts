import { Effect } from "effect"

import { Canvas } from "../core/index.js"
import {
  CritClientUnavailable,
  type CritClientShape
} from "../session/crit-client.js"
import type { CanvasRepositoryShape } from "./canvas-repository.js"
import type { AgentActivityStoreShape } from "./agent-activity.js"
import type { SnapshotServiceShape } from "./snapshot-service.js"

export interface CanvasRepositoryCritClientOptions {
  readonly createIfMissing?: boolean
  readonly title?: (id: string) => string
  readonly snapshotFrame?: SnapshotServiceShape["snapshotFrame"]
  readonly loadAgentActivity?: AgentActivityStoreShape["read"]
}

const make = (
  documents: CanvasRepositoryShape,
  options: CanvasRepositoryCritClientOptions = {}
): CritClientShape => {
  const createIfMissing = options.createIfMissing ?? false
  const title = options.title ?? ((id: string) => id)

  const createCanvas = (id: string) =>
    documents
      .create(Canvas.export(Canvas.create({ id, title: title(id) })))
      .pipe(
        Effect.catchTag("DocumentAlreadyExists", () => documents.load(id)),
        Effect.catchTag("CritClientUnavailable", (createFailure) =>
          documents.load(id).pipe(
            Effect.catch(() => Effect.fail(createFailure))
          )
        )
      )

  return {
    load: (id) =>
      documents.load(id).pipe(
        Effect.catchTag("CritClientNotFound", (cause) =>
          createIfMissing ? createCanvas(id) : Effect.fail(cause)
        )
      ),
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
    ...(options.loadAgentActivity === undefined
      ? {}
      : {
          activity: (id: string) =>
            options.loadAgentActivity!(id).pipe(
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
