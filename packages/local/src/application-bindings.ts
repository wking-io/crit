import {
  ApplicationBindings,
  type ApplicationBaseUrl
} from "@crit/representations"
import { Crypto, Effect, FileSystem, Layer, Option, Path } from "effect"

import {
  LocalProjectManifest,
  type ProjectManifestFailure
} from "./project-manifest.js"

export interface LocalProjectApplicationBindingsOptions {
  readonly root: string
  readonly baseUrl: ApplicationBaseUrl
}

export const LocalProjectApplicationBindings = {
  layer: (
    options: LocalProjectApplicationBindingsOptions
  ): Layer.Layer<
    ApplicationBindings,
    ProjectManifestFailure,
    FileSystem.FileSystem | Path.Path | Crypto.Crypto
  > => Layer.effect(ApplicationBindings, Effect.gen(function*() {
    const projectManifest = yield* LocalProjectManifest
    const manifest = yield* projectManifest.read
    const applicationId = manifest.applicationId
    const baseUrl = options.baseUrl
    return ApplicationBindings.of({
      get: (requestedApplicationId) => Effect.succeed(
        requestedApplicationId === applicationId
          ? Option.some(baseUrl)
          : Option.none()
      )
    })
  })).pipe(
    Layer.provide(LocalProjectManifest.layer({ root: options.root }))
  )
}
