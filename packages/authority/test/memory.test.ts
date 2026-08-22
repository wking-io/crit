import { Effect, Layer } from "effect"
import { it } from "vitest"

import {
  AuthorityClockLive,
  MemoryCanvasAuthority,
  authorityClockLayer
} from "../src/index.js"
import { authorityConformanceScenarios } from "../src/testing.js"

const factory = (options?: { readonly now?: Parameters<typeof authorityClockLayer>[0] }) =>
  MemoryCanvasAuthority.layer.pipe(Layer.provide(
    options?.now === undefined ? AuthorityClockLive : authorityClockLayer(options.now)
  ))

for (const scenario of authorityConformanceScenarios(factory)) {
  it(scenario.name, () => Effect.runPromise(Effect.scoped(scenario.run)))
}
