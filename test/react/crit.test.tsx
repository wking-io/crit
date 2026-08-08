import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Crit } from "../../src/react/crit.js"
import {
  CanvasViewport,
  frameToolbarMode
} from "../../src/react/canvas-viewport.js"
import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { Effect } from "effect"

describe("Crit", () => {
  it("uses explicit Frame toolbar breakpoints", () => {
    expect(frameToolbarMode(800)).toBe("full")
    expect(frameToolbarMode(519)).toBe("compact")
    expect(frameToolbarMode(259)).toBe("minimal")
  })

  it("renders its loading boundary with the default HTTP client", () => {
    const html = renderToStaticMarkup(<Crit canvasId="homepage" />)

    expect(html).toContain("Opening canvas…")
  })

  it("renders Frames and attached Notes without a canvas framework", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review" })
    await Effect.runPromise(Canvas.apply(
      canvas,
      CanvasCommand.addFrame({
        id: "candidate",
        url: "https://example.com/candidate",
        title: "Candidate",
        status: "approved",
        provenance: { kind: "manual", sourceId: "test" }
      }),
      CanvasCommand.addNote({ id: "feedback", text: "Tighten spacing", x: 40, y: 50 }),
      CanvasCommand.attachNote({ id: "feedback", frameId: "candidate" })
    ))

    const html = renderToStaticMarkup(
      <CanvasViewport
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
      />
    )

    expect(html).toContain("Candidate")
    expect(html).toContain("Approved")
    expect(html).toContain("Attached to candidate")
    expect(html).toContain("Tighten spacing")
    expect(html).toContain("Send Candidate to back")
    expect(html).toContain("Bring Candidate to front")
    expect(html).toContain("Send note to back")
    expect(html).toContain("Bring note to front")
  })

  it("offers snapshot capture for live Frames", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review" })
    await Effect.runPromise(
      Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://example.com/candidate",
          title: "Candidate",
          provenance: { kind: "manual", sourceId: "test" }
        })
      )
    )

    const html = renderToStaticMarkup(
      <CanvasViewport
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
        snapshotFrame={() => Effect.void}
      />
    )

    expect(html).toContain("Take snapshot")
  })
})
