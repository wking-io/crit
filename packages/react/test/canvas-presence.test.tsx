import type { CanvasId, PresenceRoster } from "@crit/domain"
import { Id, decodePresenceRoster } from "@crit/domain"
import { StrictMode, act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useCanvasPresence } from "../src/index.js"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true })

const canvasId = Id.canvas("canvas_presence_hook")
const otherCanvas = Id.canvas("canvas_presence_other")

const roster = decodePresenceRoster({
  _tag: "presenceRoster",
  canvasId,
  people: [{
    _tag: "connectedPerson",
    person: {
      _tag: "person",
      personId: "person_ada",
      displayName: "Ada",
      email: { _tag: "unspecified" }
    }
  }]
})

let latest: PresenceRoster | undefined
let attendCalls = 0
let unsubscribed = 0

const Probe = (props: {
  readonly canvasId: CanvasId
  readonly roster: PresenceRoster
}): ReactElement => {
  latest = useCanvasPresence({
    canvasId: props.canvasId,
    attend: (_canvasId, onRoster) => {
      attendCalls += 1
      onRoster(props.roster)
      return () => {
        unsubscribed += 1
      }
    }
  })
  return <output>{latest?.people.map((person) => person.person.displayName).join(",")}</output>
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  attendCalls = 0
  unsubscribed = 0
  latest = undefined
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async() => {
  await act(async() => root.unmount())
  container.remove()
})

describe("useCanvasPresence", () => {
  it("publishes the roster from attend and leaves on unmount", async() => {
    await act(async() => root.render(
      <StrictMode>
        <Probe canvasId={canvasId} roster={roster} />
      </StrictMode>
    ))

    expect(latest).toEqual(roster)
    expect(container.querySelector("output")?.textContent).toBe("Ada")

    await act(async() => root.unmount())
    expect(unsubscribed).toBeGreaterThan(0)
    expect(attendCalls).toBeGreaterThan(0)
  })

  it("clears the previous roster when the Canvas changes", async() => {
    await act(async() => root.render(
      <StrictMode>
        <Probe canvasId={canvasId} roster={roster} />
      </StrictMode>
    ))
    expect(latest).toEqual(roster)

    await act(async() => root.render(
      <StrictMode>
        <Probe canvasId={otherCanvas} roster={roster} />
      </StrictMode>
    ))
    expect(latest).toEqual(roster)
    expect(unsubscribed).toBeGreaterThan(0)
  })
})
