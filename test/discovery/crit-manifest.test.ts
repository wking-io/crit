import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  CritManifest,
  CritManifestInvalid
} from "../../src/discovery/index.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import {
  CritRuntime,
  CritRuntimeLive
} from "../../src/runtime/crit-runtime.js"

describe("CritManifest", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "crit-manifest-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const input = {
    schemaVersion: 1 as const,
    id: "storefront",
    canvases: [
      {
        id: "checkout-review",
        title: "Checkout review",
        frames: [
          {
            id: "current",
            url: "/checkout",
            title: "Current checkout",
            status: "in-progress" as const,
            geometry: { x: 40, y: 60, width: 1024, height: 720 }
          }
        ]
      }
    ]
  }

  it("resolves paths and rejects ambiguous identities", async () => {
    const resolved = await Effect.runPromise(
      CritManifest.resolve(input, {
        baseUrl: "https://iteration.localhost/.well-known/crit.json"
      })
    )
    const duplicate = await Effect.runPromise(
      Effect.flip(
        CritManifest.resolve(
          {
            ...input,
            canvases: [input.canvases[0], input.canvases[0]]
          },
          { baseUrl: "https://iteration.localhost" }
        )
      )
    )

    expect(resolved.canvases[0]?.frames[0]).toMatchObject({
      id: "current",
      url: "https://iteration.localhost/checkout",
      status: "in-progress"
    })
    expect(duplicate).toBeInstanceOf(CritManifestInvalid)
    expect(duplicate.detail).toContain("Duplicate Canvas ID")
  })

  it("creates and idempotently reconciles manifest Frames through the runtime interface", async () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const runtimeLayer = CritRuntimeLive.pipe(Layer.provide(storeLayer))
    const resolved = await Effect.runPromise(
      CritManifest.resolve(input, { baseUrl: "https://iteration.localhost" })
    )

    const first = await Effect.runPromise(
      CritManifest.sync(resolved).pipe(Effect.provide(runtimeLayer))
    )
    const second = await Effect.runPromise(
      CritManifest.sync(resolved).pipe(Effect.provide(runtimeLayer))
    )
    const changed = await Effect.runPromise(
      CritManifest.resolve(
        {
          ...input,
          canvases: [
            {
              ...input.canvases[0],
              frames: [
                {
                  ...input.canvases[0]!.frames[0]!,
                  url: "/checkout/v2",
                  status: "approved" as const
                }
              ]
            }
          ]
        },
        { baseUrl: "https://iteration.localhost" }
      )
    )
    const third = await Effect.runPromise(
      Effect.gen(function*() {
        const sync = yield* CritManifest.sync(changed)
        const runtime = yield* CritRuntime
        const canvas = yield* runtime.getCanvas("checkout-review")
        return { sync, canvas }
      }).pipe(Effect.provide(runtimeLayer))
    )
    const statusUnmanaged = await Effect.runPromise(
      CritManifest.resolve(
        {
          ...input,
          canvases: [
            {
              ...input.canvases[0],
              frames: [
                {
                  id: "current",
                  url: "/checkout/v3",
                  title: "Current checkout",
                  geometry: { x: 40, y: 60, width: 1024, height: 720 }
                }
              ]
            }
          ]
        },
        { baseUrl: "https://iteration.localhost" }
      )
    )
    const fourth = await Effect.runPromise(
      Effect.gen(function*() {
        const sync = yield* CritManifest.sync(statusUnmanaged)
        const runtime = yield* CritRuntime
        const canvas = yield* runtime.getCanvas("checkout-review")
        return { sync, canvas }
      }).pipe(Effect.provide(runtimeLayer))
    )
    const empty = await Effect.runPromise(
      CritManifest.resolve(
        {
          ...input,
          canvases: [{ ...input.canvases[0], frames: [] }]
        },
        { baseUrl: "https://iteration.localhost" }
      )
    )
    const fifth = await Effect.runPromise(
      Effect.gen(function*() {
        const sync = yield* CritManifest.sync(empty)
        const runtime = yield* CritRuntime
        const canvas = yield* runtime.getCanvas("checkout-review")
        return { sync, canvas }
      }).pipe(Effect.provide(runtimeLayer))
    )

    expect(first.canvases[0]).toMatchObject({
      action: "created",
      revision: 1,
      addedFrameIds: ["current"]
    })
    expect(second.canvases[0]).toMatchObject({
      action: "unchanged",
      revision: 1,
      unchangedFrameIds: ["current"]
    })
    expect(third.sync.canvases[0]).toMatchObject({
      action: "updated",
      revision: 2,
      updatedFrameIds: ["current"]
    })
    expect(third.canvas.frames[0]).toMatchObject({
      id: "current",
      url: "https://iteration.localhost/checkout/v2",
      status: "approved",
      provenance: {
        kind: "manifest",
        sourceId: "storefront:checkout-review:current"
      },
      geometry: { x: 40, y: 60, width: 1024, height: 720 }
    })
    expect(fourth.sync.canvases[0]).toMatchObject({
      action: "updated",
      revision: 3
    })
    expect(fourth.canvas.frames[0]).toMatchObject({
      url: "https://iteration.localhost/checkout/v3",
      status: "approved"
    })
    expect(fifth.sync.canvases[0]).toMatchObject({
      action: "unchanged",
      revision: 3
    })
    expect(fifth.canvas.frames).toHaveLength(1)
  })
})
