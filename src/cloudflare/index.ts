import { Effect } from "effect"

import {
  isCritHttpRequest,
  makeCritHttpHandler,
  type CritHttpHandlerOptions
} from "../http/contract.js"
import {
  DocumentStoreCritClient,
  type DocumentStoreCritClientOptions
} from "../runtime/document-store-crit-client.js"
import {
  D1DocumentStore,
  type D1DatabaseLike
} from "./d1-document-store.js"

export {
  CRIT_D1_MIGRATION_0001,
  D1DocumentStore,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type D1ResultLike
} from "./d1-document-store.js"

export interface CritCloudflareHandlerOptions
  extends CritHttpHandlerOptions,
    DocumentStoreCritClientOptions {
  readonly enabled?: boolean
  readonly initializeSchema?: boolean
}

export interface CritCloudflareRequestContext {
  readonly database: D1DatabaseLike
  readonly enabled?: boolean
}

export type CritCloudflareHandler = (
  request: Request,
  context: CritCloudflareRequestContext
) => Promise<Response | null>

export const makeCritCloudflareHandler = (
  options: CritCloudflareHandlerOptions = {}
): CritCloudflareHandler => {
  const initialized = new WeakMap<D1DatabaseLike, Promise<void>>()

  const ensureSchema = (database: D1DatabaseLike) => {
    const existing = initialized.get(database)
    if (existing !== undefined) return existing

    const pending = Effect.runPromise(D1DocumentStore.initialize(database)).catch(
      (cause: unknown) => {
        initialized.delete(database)
        throw cause
      }
    )
    initialized.set(database, pending)
    return pending
  }

  return async (request, context) => {
    if (!(options.enabled ?? true) || !(context.enabled ?? true)) return null
    if (!isCritHttpRequest(request.url, options.apiPath)) return null
    if (options.initializeSchema ?? true) {
      await ensureSchema(context.database)
    }

    const client = DocumentStoreCritClient.make(
      D1DocumentStore.make(context.database),
      {
        createIfMissing: options.createIfMissing ?? true,
        ...(options.title === undefined ? {} : { title: options.title })
      }
    )
    const handler = makeCritHttpHandler(client, {
      ...(options.apiPath === undefined ? {} : { apiPath: options.apiPath }),
      ...(options.maxBodyBytes === undefined
        ? {}
        : { maxBodyBytes: options.maxBodyBytes })
    })
    return Effect.runPromise(handler(request))
  }
}
