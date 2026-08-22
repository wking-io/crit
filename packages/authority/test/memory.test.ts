import { Effect } from "effect"
import { it } from "vitest"

import { makeMemoryCanvasAuthority } from "../src/index.js"
import { authorityConformanceScenarios } from "../src/testing.js"

for (const scenario of authorityConformanceScenarios(makeMemoryCanvasAuthority)) {
  it(scenario.name, () => Effect.runPromise(scenario.run))
}
