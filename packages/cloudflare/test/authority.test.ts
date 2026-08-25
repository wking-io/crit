import {
  AuthorityClockLive,
  authorityClockLayer
} from "@crit/authority"
import { authorityConformanceScenarios } from "@crit/authority/testing"
import { Effect, Layer } from "effect"
import { it } from "vitest"

import { CloudflareCanvasAuthority } from "../src/index.js"

const factory = (options?: { readonly now?: Parameters<typeof authorityClockLayer>[0] }) =>
  CloudflareCanvasAuthority.layer.pipe(Layer.provide(
    options?.now === undefined ? AuthorityClockLive : authorityClockLayer(options.now)
  ))

for (const scenario of authorityConformanceScenarios(factory)) {
  it(scenario.name, () => Effect.runPromise(Effect.scoped(scenario.run)))
}
