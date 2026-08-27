import {
  ApplicationId
} from "@crit/domain"
import {
  ApplicationBindings,
  ApplicationBaseUrl
} from "@crit/representations"
import { LocalDaemonInstanceNonce } from "@crit/replica/http"
import {
  Context,
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Ref,
  Result,
  Schema
} from "effect"

import {
  LocalProjectManifest,
  type ProjectManifestFailure
} from "./project-manifest.js"

export const localApplicationAnnouncePath = "/api/v1/applications/announce"

export const LocalApplicationAnnounceRequest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  applicationId: ApplicationId,
  origin: ApplicationBaseUrl,
  instance: LocalDaemonInstanceNonce
})
export type LocalApplicationAnnounceRequest = typeof LocalApplicationAnnounceRequest.Type

export type LocalApplicationBinding =
  | {
    readonly _tag: "flag"
    readonly applicationId: ApplicationId
    readonly baseUrl: ApplicationBaseUrl
  }
  | {
    readonly _tag: "announced"
    readonly applicationId: ApplicationId
    readonly baseUrl: ApplicationBaseUrl
  }
  | { readonly _tag: "unbound" }

export interface LocalApplicationAnnouncementsService {
  readonly record: (
    applicationId: ApplicationId,
    origin: ApplicationBaseUrl
  ) => Effect.Effect<void>
  readonly lookup: (
    applicationId: ApplicationId
  ) => Effect.Effect<Option.Option<ApplicationBaseUrl>>
}

export class LocalApplicationAnnouncements extends Context.Service<
  LocalApplicationAnnouncements,
  LocalApplicationAnnouncementsService
>()("@crit/local/LocalApplicationAnnouncements") {
  static readonly layer: Layer.Layer<LocalApplicationAnnouncements> = Layer.effect(
    LocalApplicationAnnouncements,
    Effect.gen(function*() {
      const origins = yield* Ref.make(new Map<ApplicationId, ApplicationBaseUrl>())
      return LocalApplicationAnnouncements.of({
        record: (applicationId, origin) => Ref.update(origins, (current) => {
          const next = new Map(current)
          next.set(applicationId, origin)
          return next
        }),
        lookup: (applicationId) => Ref.get(origins).pipe(
          Effect.map((current) => Option.fromUndefinedOr(current.get(applicationId)))
        )
      })
    })
  )
}

export interface LocalProjectApplicationBindingsOptions {
  readonly root: string
  readonly baseUrl?: ApplicationBaseUrl
}

export const LocalProjectApplicationBindings = {
  layer: (
    options: LocalProjectApplicationBindingsOptions
  ): Layer.Layer<
    ApplicationBindings,
    ProjectManifestFailure,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto | LocalApplicationAnnouncements
  > => Layer.effect(ApplicationBindings, Effect.gen(function*() {
    const projectManifest = yield* LocalProjectManifest
    const announcements = yield* LocalApplicationAnnouncements
    const loaded = yield* projectManifest.read.pipe(Effect.result)
    if (Result.isFailure(loaded)) {
      const missing = Predicate.isTagged(loaded.failure, "ProjectManifestIoFailure")
        && loaded.failure.operation === "inspect"
        && loaded.failure.reason === "NotFound"
      if (missing && options.baseUrl === undefined) {
        return ApplicationBindings.of({
          get: () => Effect.succeed(Option.none())
        })
      }
      return yield* Effect.fail(loaded.failure)
    }
    const applicationId = loaded.success.applicationId
    const resolve = (requestedApplicationId: ApplicationId): Effect.Effect<LocalApplicationBinding> => {
      if (requestedApplicationId !== applicationId) {
        return Effect.succeed({ _tag: "unbound" })
      }
      if (options.baseUrl !== undefined) {
        return Effect.succeed({
          _tag: "flag",
          applicationId,
          baseUrl: options.baseUrl
        })
      }
      return announcements.lookup(requestedApplicationId).pipe(
        Effect.map(Option.match({
          onNone: (): LocalApplicationBinding => ({ _tag: "unbound" }),
          onSome: (baseUrl): LocalApplicationBinding => ({
            _tag: "announced",
            applicationId,
            baseUrl
          })
        }))
      )
    }
    return ApplicationBindings.of({
      get: (requestedApplicationId) => resolve(requestedApplicationId).pipe(
        Effect.map((binding) =>
          binding._tag === "unbound" ? Option.none() : Option.some(binding.baseUrl)
        )
      )
    })
  })).pipe(
    Layer.provide(LocalProjectManifest.layer({ root: options.root }))
  )
}
