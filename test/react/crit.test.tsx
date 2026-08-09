import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Crit } from "../../src/react/crit.js"
import {
  CanvasHelpPanel,
  CanvasHelpSurface
} from "../../src/react/canvas-help.js"
import {
  CanvasViewport,
  frameChromeLayout,
  frameChromeMetrics,
  frameUiScale,
  frameToolbarMode
} from "../../src/react/canvas-viewport.js"
import { CanvasSelection } from "../../src/react/canvas-selection.js"
import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { Effect } from "effect"

describe("Crit", () => {
  it("keeps the title until fewer than ten characters fit", () => {
    expect(frameToolbarMode(223)).toBe("full")
    expect(frameToolbarMode(222)).toBe("compact")
    expect(frameToolbarMode(151)).toBe("minimal")
  })

  it("progressively hides Frame actions only when their width budget runs out", () => {
    expect(frameChromeLayout(150, 1, true).actions).toEqual({
      snapshot: true,
      open: true,
      fullscreen: true,
      delete: true
    })
    expect(frameChromeLayout(120, 1, true).actions).toEqual({
      snapshot: false,
      open: true,
      fullscreen: true,
      delete: true
    })
    expect(frameChromeLayout(150, 1, true, {
      openMinimumWidth: 151,
      deleteMinimumWidth: 151
    }).actions).toMatchObject({ open: false, delete: false })
    expect(frameChromeMetrics(245, 1, 5, {
      titleMinimumCharacters: 11
    }).titleVisible).toBe(false)
  })

  it("keeps Frame chrome proportional and resize-driven across zoom", () => {
    expect(frameChromeMetrics(600, 0.25)).toEqual({
      screenHeight: 28,
      titleVisible: false,
      toolbarMode: "minimal"
    })
    expect(frameChromeMetrics(600, 2)).toEqual({
      screenHeight: 28,
      titleVisible: true,
      toolbarMode: "full"
    })
    expect(frameChromeMetrics(244, 0.25).titleVisible).toBe(false)
    expect(frameChromeMetrics(244, 2).titleVisible).toBe(true)
    expect(frameUiScale(0.25) * 0.25).toBeCloseTo(1)
    expect(frameUiScale(2) * 2).toBeCloseTo(1)
  })

  it("renders its loading boundary with the default HTTP client", () => {
    const html = renderToStaticMarkup(<Crit canvasId="homepage" />)

    expect(html).toContain("Opening canvas…")
  })

  it("hides inactive help and emits complete details for canvas controls", () => {
    const canvas = Canvas.create({ id: "review", title: "Review" })
    const html = renderToStaticMarkup(
      <CanvasHelpSurface>
        <CanvasViewport
          dispatch={() => Effect.void}
          document={Canvas.export(canvas)}
        />
        <CanvasHelpPanel />
      </CanvasHelpSurface>
    )

    expect(html).not.toContain('aria-label="Control help"')
    expect(html).not.toContain("Arrange frames and notes on an infinite canvas")
    expect(html).toContain('data-crit-help-name="Select"')
    expect(html).toContain('data-crit-help-hotkey="V"')
    expect(html).toContain(
      'data-crit-help-description="Select, move, resize, and interact with frames and notes."'
    )
    expect(html).toContain('data-crit-help-name="Add frame"')
    expect(html).toContain('data-crit-help-name="Add note"')
    expect(html).toContain('data-crit-help-hotkey="F"')
    expect(html).toContain('data-crit-help-hotkey="N"')
    expect(html).not.toContain("crit-tooltip")

    const detailCounts = [
      html.match(/data-crit-help-name=/g)?.length ?? 0,
      html.match(/data-crit-help-hotkey=/g)?.length ?? 0,
      html.match(/data-crit-help-description=/g)?.length ?? 0
    ]
    expect(new Set(detailCounts).size).toBe(1)
  })

  it("describes resize handles through contextual help", () => {
    const html = renderToStaticMarkup(
      <CanvasSelection
        ink="#000"
        label="frame"
        onResize={() => undefined}
        zoom={1}
      />
    )

    expect(html).toContain('data-crit-help-name="Resize"')
    expect(html).toContain(
      'data-crit-help-description="Drag to resize the frame in this direction."'
    )
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
      CanvasCommand.addFrame({
        id: "ready",
        url: "https://example.com/ready",
        title: "Ready candidate",
        status: "ready-for-review",
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
    expect(html).toContain("Ready for review")
    expect(html).toContain("Status: Approved. Change status")
    expect(html).toContain("A: Candidate")
    expect(html).toContain("Attached to candidate")
    expect(html).toContain("Tighten spacing")
    expect(html).toContain("Send note to back")
    expect(html).toContain("Bring note to front")
    expect(html).toContain('data-crit-help-name="Frame status"')
    expect(html).toContain('data-crit-help-name="Edit frame title"')
    expect(html).toContain('data-crit-help-name="Edit note"')
    expect(html).toContain('data-crit-help-name="Send to back"')
    expect(html).not.toContain("Layer options for Candidate")
    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('aria-keyshortcuts="V"')
    expect(html).toContain('aria-keyshortcuts="H"')
    expect(html).toContain('aria-keyshortcuts="F"')
    expect(html).toContain('aria-keyshortcuts="N"')
    expect(html).toContain('aria-keyshortcuts="Delete"')
    expect(html).toContain('aria-label="Select"')
    expect(html).toContain('aria-label="Hand"')
    expect(html.indexOf('aria-label="Select"')).toBeLessThan(
      html.indexOf('aria-label="Hand"')
    )
    expect(html).toContain('aria-label="Select" aria-pressed="true"')
    expect(html).toContain('aria-label="Hand" aria-pressed="false"')
    expect(html).toContain('aria-label="Add frame"')
    expect(html).toContain('aria-label="Add note"')
    expect(html).not.toContain("Fit canvas")
    expect(html).not.toContain("Zoom in")
    expect(html).not.toContain("Zoom out")
    expect(html).not.toContain('aria-label="Resize"')
  })

  it("sandboxes archived Frame artifacts while leaving live Frames unsandboxed", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review" })
    await Effect.runPromise(
      Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://example.com/candidate",
          title: "Candidate",
          provenance: { kind: "manual", sourceId: "test" }
        }),
        CanvasCommand.addSnapshotFrame({
          id: "snapshot-artifact",
          sourceFrameId: "candidate",
          expectedSourceUrl: "https://example.com/candidate",
          url: "/__crit/snapshots/artifact",
          artifact: {
            artifactId: "artifact",
            sourceUrl: "https://example.com/candidate",
            capturedAt: "2026-01-01T00:00:00.000Z",
            sizeBytes: 512
          }
        }),
        // Server rendering has a zero-sized viewport, so pull the archived
        // Frame back inside the iframe mount margin.
        CanvasCommand.moveFrame({ id: "snapshot-artifact", x: 0, y: 0 })
      )
    )

    const html = renderToStaticMarkup(
      <CanvasViewport
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
      />
    )

    const iframes = html.match(/<iframe[^>]*>/g) ?? []
    const archived = iframes.filter((tag) => tag.includes("/__crit/snapshots/"))
    const live = iframes.filter((tag) => tag.includes("example.com/candidate"))
    expect(archived).toHaveLength(1)
    expect(live).toHaveLength(1)
    expect(archived[0]).toContain('sandbox="allow-scripts"')
    expect(live[0]).not.toContain("sandbox")
  })

  it("keeps an explicit iframeSandbox policy for archived Frames", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review" })
    await Effect.runPromise(
      Canvas.apply(
        canvas,
        CanvasCommand.addFrame({
          id: "candidate",
          url: "https://example.com/candidate",
          title: "Candidate",
          provenance: { kind: "manual", sourceId: "test" }
        }),
        CanvasCommand.addSnapshotFrame({
          id: "snapshot-artifact",
          sourceFrameId: "candidate",
          expectedSourceUrl: "https://example.com/candidate",
          url: "/__crit/snapshots/artifact",
          artifact: {
            artifactId: "artifact",
            sourceUrl: "https://example.com/candidate",
            capturedAt: "2026-01-01T00:00:00.000Z",
            sizeBytes: 512
          }
        }),
        // Server rendering has a zero-sized viewport, so pull the archived
        // Frame back inside the iframe mount margin.
        CanvasCommand.moveFrame({ id: "snapshot-artifact", x: 0, y: 0 })
      )
    )

    const html = renderToStaticMarkup(
      <CanvasViewport
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
        iframeSandbox="allow-scripts allow-forms"
      />
    )

    const iframes = html.match(/<iframe[^>]*>/g) ?? []
    expect(iframes.length).toBeGreaterThan(0)
    for (const tag of iframes) {
      expect(tag).toContain('sandbox="allow-scripts allow-forms"')
    }
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
