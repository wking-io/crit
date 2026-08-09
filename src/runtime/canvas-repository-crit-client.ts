import { Effect } from "effect"

import { Canvas, CanvasUnavailable } from "../core/index.js"
import type { CritClientShape } from "../session/crit-client.js"
import type { CanvasRepositoryShape } from "./canvas-repository.js"
import type { AgentActivityStoreShape } from "./agent-activity.js"
import type { SnapshotServiceShape } from "./snapshot-service.js"

export interface CanvasRepositoryCritClientOptions {
  readonly createIfMissing?: boolean
  readonly title?: (id: string) => string
  readonly snapshotFrame?: SnapshotServiceShape["snapshotFrame"]
  readonly loadAgentActivity?: AgentActivityStoreShape["read"]
}

// The repository and the client share one failure vocabulary, so this adapter
// only adds behavior (create-if-missing); it never translates errors.
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
        Effect.catchTag("CanvasAlreadyExists", () => documents.load(id)),
        Effect.catchTag("CanvasUnavailable", (createFailure) =>
          documents.load(id).pipe(
            Effect.catch(() => Effect.fail(createFailure))
          )
        )
      )

  return {
    load: (id) =>
      documents.load(id).pipe(
        Effect.catchTag("CanvasNotFound", (cause) =>
          createIfMissing ? createCanvas(id) : Effect.fail(cause)
        )
      ),
    apply: (id, commands) =>
      documents.apply(id, commands).pipe(
        Effect.map((mutation) => mutation.document)
      ),
    ...(options.snapshotFrame === undefined
      ? {}
      : { snapshot: options.snapshotFrame }),
    ...(options.loadAgentActivity === undefined
      ? {}
      : {
          activity: (id: string) =>
            options.loadAgentActivity!(id).pipe(
              Effect.mapError(
                (cause) =>
                  new CanvasUnavailable({
                    operation: "activity",
                    canvasId: id,
                    detail: cause.detail
                  })
              )
            )
        })
  }
}

export const CanvasRepositoryCritClient = { make } as const
