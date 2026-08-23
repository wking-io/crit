import { DomainValue } from "@crit/domain"
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
    const binding = DomainValue.detach({
      applicationId: manifest.applicationId,
      baseUrl: options.baseUrl
    })
    return ApplicationBindings.of({
      get: (applicationId) => Effect.succeed(
        applicationId === binding.applicationId
          ? Option.some(binding.baseUrl)
          : Option.none()
      )
    })
  })).pipe(
    Layer.provide(LocalProjectManifest.layer({ root: options.root }))
  )
}
