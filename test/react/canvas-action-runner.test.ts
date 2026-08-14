import { Deferred, Effect } from "effect"
import { describe, expect, it } from "vitest"

import { makeCanvasActionExecutor } from "../../src/react/canvas-action-runner.js"
import { CanvasControls } from "../../src/react/canvas-controls.js"

const controls = CanvasControls.resolve({
  platform: "macos",
  activeScopes: ["canvas"],
  globalFacts: { commentAuthorPresent: true },
  pendingActions: []
})

describe("Canvas action runner", () => {
  it("runs one action at a time per identity and target", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const pending: Array<ReadonlyArray<string>> = []
    let starts = 0
    const executor = makeCanvasActionExecutor({
      onPendingChange: (actions) => pending.push(actions)
    })
    const action = controls.action({
      id: "remove-item",
      target: { kind: "frame", id: "candidate", label: "Candidate" }
    })
    const execution = Effect.sync(() => { starts += 1 }).pipe(
      Effect.andThen(Deferred.await(gate))
    )

    executor.run(controls, action, execution)
    executor.run(controls, action, execution)

    expect(starts).toBe(1)
    expect(executor.pendingActions()).toEqual([action.key])

    await Effect.runPromise(Deferred.succeed(gate, undefined))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executor.pendingActions()).toEqual([])
    expect(pending).toEqual([[action.key], []])
  })

  it("silently interrupts owned work during disposal", async () => {
    const failures: Array<unknown> = []
    const executor = makeCanvasActionExecutor({ onError: (cause) => failures.push(cause) })
    const action = controls.action({ id: "zoom-to-fit" })

    executor.run(controls, action, Effect.never)
    executor.dispose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(failures).toEqual([])
    expect(executor.pendingActions()).toEqual([])
  })
})
