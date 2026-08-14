import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  CritManifest,
  CritManifestInvalid
} from "../../src/discovery/index.js"
import { Canvas } from "../../src/core/index.js"
import { FileSystemCanvasRepository } from "../../src/node/file-system-canvas-repository.js"
import { TEST_AUTHOR } from "../support/author-identity.js"
import { CanvasRepository } from "../../src/runtime/canvas-repository.js"

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
            canvases: [input.canvases[0]!, input.canvases[0]!]
          },
          { baseUrl: "https://iteration.localhost" }
        )
      )
    )

    expect(resolved.canvases[0]?.frames[0]).toMatchObject({
      id: "current",
      url: "https://iteration.localhost/checkout",
      status: { _tag: "Managed", value: "in-progress" },
      display: { _tag: "Unmanaged" },
      geometry: {
        _tag: "Managed",
        value: { x: 40, y: 60, width: 1024, height: 720 }
      }
    })
    expect(CritManifest.toDocument(resolved).canvases[0]?.frames[0]).toEqual({
      id: "current",
      url: "https://iteration.localhost/checkout",
      title: "Current checkout",
      status: "in-progress",
      geometry: { x: 40, y: 60, width: 1024, height: 720 }
    })
    expect(duplicate).toBeInstanceOf(CritManifestInvalid)
    expect(duplicate.detail).toContain("Duplicate Canvas ID")
  })

  it("creates and idempotently reconciles manifest Frames through the repository interface", async () => {
    const storeLayer = FileSystemCanvasRepository.layer({ root })
    const resolved = await Effect.runPromise(
      CritManifest.resolve(input, { baseUrl: "https://iteration.localhost" })
    )

    const first = await Effect.runPromise(
      CritManifest.sync(resolved, { owner: TEST_AUTHOR }).pipe(Effect.provide(storeLayer))
    )
    const second = await Effect.runPromise(
      CritManifest.sync(resolved, { owner: TEST_AUTHOR }).pipe(Effect.provide(storeLayer))
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
        const sync = yield* CritManifest.sync(changed, { owner: TEST_AUTHOR })
        const documents = yield* CanvasRepository
        const canvas = Canvas.fromDocument(yield* documents.load("checkout-review"))
        return { sync, frames: Canvas.listFrames(canvas) }
      }).pipe(Effect.provide(storeLayer))
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
        const sync = yield* CritManifest.sync(statusUnmanaged, { owner: TEST_AUTHOR })
        const documents = yield* CanvasRepository
        const canvas = Canvas.fromDocument(yield* documents.load("checkout-review"))
        return { sync, frames: Canvas.listFrames(canvas) }
      }).pipe(Effect.provide(storeLayer))
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
        const sync = yield* CritManifest.sync(empty, { owner: TEST_AUTHOR })
        const documents = yield* CanvasRepository
        const canvas = Canvas.fromDocument(yield* documents.load("checkout-review"))
        return { sync, frames: Canvas.listFrames(canvas) }
      }).pipe(Effect.provide(storeLayer))
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
    expect(third.frames[0]).toMatchObject({
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
    expect(fourth.frames[0]).toMatchObject({
      url: "https://iteration.localhost/checkout/v3",
      status: "approved"
    })
    expect(fifth.sync.canvases[0]).toMatchObject({
      action: "unchanged",
      revision: 3
    })
    expect(fifth.frames).toHaveLength(1)
  })
})
