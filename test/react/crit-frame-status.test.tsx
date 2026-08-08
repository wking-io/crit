import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode
} from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CritFrame } from "../../src/core/index.js"

const harness = vi.hoisted(() => ({
  toolId: "select",
  updateShape: vi.fn()
}))

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useState: <T,>(initial: T) => [initial, vi.fn()] as const
  }
})

vi.mock("tldraw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("tldraw")>()
  return {
    ...actual,
    HTMLContainer: "div",
    stopEventPropagation: vi.fn(),
    useEditor: () => ({
      getCurrentToolId: () => harness.toolId,
      updateShape: harness.updateShape
    }),
    useValue: (_name: string, compute: () => unknown) => compute()
  }
})

import { CritFrameShapeUtil } from "../../src/react/crit-frame.js"

const shape = {
  id: "shape:candidate",
  typeName: "shape",
  type: "crit-frame",
  x: 0,
  y: 0,
  rotation: 0,
  index: "a1",
  parentId: "page:review",
  isLocked: false,
  opacity: 1,
  meta: {},
  props: {
    w: 1200,
    h: 800,
    url: "https://checkout.localhost",
    title: "Checkout candidate",
    status: "in-progress",
    provenance: { kind: "manual", sourceId: "browser" },
    display: { heightMode: "viewport" }
  }
} as CritFrame

const renderFrame = () => {
  const util = Object.create(
    CritFrameShapeUtil.prototype
  ) as CritFrameShapeUtil
  const view = util.component(shape) as ReactElement
  if (typeof view.type !== "function") throw new TypeError("Expected Frame view")
  const render = view.type as unknown as (
    props: typeof view.props
  ) => ReactElement<{ children: ReactNode }>
  const container = render(view.props)
  const header = Children.toArray(container.props.children)[0] as ReactElement<{
    children: ReactNode
  }>
  const selectNode = Children.toArray(header.props.children).find(
    (child) => isValidElement(child) && child.type === "select"
  )
  if (selectNode === undefined) throw new TypeError("Expected status selector")
  return selectNode as ReactElement<{
    disabled: boolean
    onChange: (event: { currentTarget: { value: string } }) => void
    value: string
    children: ReactNode
  }>
}

describe("Crit Frame status control", () => {
  beforeEach(() => {
    harness.toolId = "select"
    harness.updateShape.mockReset()
  })

  it("offers every review status and updates the tldraw Frame record", () => {
    const select = renderFrame()
    const values = Children.toArray(select.props.children).map(
      (child) => (child as ReactElement<{ value: string }>).props.value
    )

    select.props.onChange({ currentTarget: { value: "approved" } })

    expect(values).toEqual([
      "in-progress",
      "approved",
      "changes-requested"
    ])
    expect(select.props.value).toBe("in-progress")
    expect(harness.updateShape).toHaveBeenCalledWith({
      id: "shape:candidate",
      type: "crit-frame",
      props: { status: "approved" }
    })
  })

  it("disables status interaction outside the pointer tool", () => {
    harness.toolId = "draw"

    expect(renderFrame().props.disabled).toBe(true)
  })
})
