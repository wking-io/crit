import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { Canvas } from "../../src/core/index.js"

describe("Canvas Asset policy", () => {
  it.effect("rejects an Asset-bearing document with a typed failure", () =>
    Effect.gen(function*() {
      const exported = structuredClone(
        Canvas.export(Canvas.create({ id: "review", title: "Review" }))
      ) as {
        document: { store: Record<string, unknown> }
      }
      exported.document.store["asset:unsupported"] = {
        id: "asset:unsupported",
        typeName: "asset",
        type: "image",
        props: {},
        meta: {}
      }

      const failure = yield* Effect.flip(Canvas.open(exported))

      expect(failure).toMatchObject({
        _tag: "AssetUnsupported",
        assetIds: ["asset:unsupported"]
      })
    }))
})
