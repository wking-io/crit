import { Effect } from "effect"

import type { Author } from "../core/index.js"
import { CanvasRepositoryCritClient } from "../runtime/canvas-repository-crit-client.js"
import { CritClientUnavailable, type CritClientServices } from "../session/crit-client.js"
import {
  IndexedDbCanvasRepository,
  type IndexedDbCanvasRepositoryOptions
} from "./indexeddb-canvas-repository.js"

export type BrowserCritClientOptions = IndexedDbCanvasRepositoryOptions & {
  readonly author: Author | null
}

export const BrowserCritClient = {
  make: (options: BrowserCritClientOptions): CritClientServices => {
    const documents = IndexedDbCanvasRepository.make(options)
    return {
      client: CanvasRepositoryCritClient.make(documents, {
        currentAuthor: () =>
          options.author === null
            ? Effect.fail(
              new CritClientUnavailable({
                operation: "current-author",
                id: "current-author",
                detail: "Sign in to add frames and notes"
              })
            )
            : Effect.succeed(options.author)
      }),
      snapshots: null,
      activity: null
    }
  }
}
