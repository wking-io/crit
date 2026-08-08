import { Effect } from "effect"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Crit } from "../../src/react/crit.js"
import type { CritClientShape } from "../../src/session/crit-client.js"

describe("Crit", () => {
  it("renders its loading boundary before opening the scoped session", () => {
    const client: CritClientShape = {
      load: () => Effect.die(new Error("not run during server rendering")),
      save: () => Effect.die(new Error("not run during server rendering"))
    }

    const html = renderToStaticMarkup(
      <Crit canvasId="homepage" client={client} />
    )

    expect(html).toContain("Opening canvas…")
  })
})
