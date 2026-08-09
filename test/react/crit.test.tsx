import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Crit } from "../../src/react/crit.js"
import {
  CanvasViewport,
  CRIT_HOTKEYS,
  DEFAULT_FRAME_CHROME_SETTINGS,
  FRAME_SIZE_PRESETS,
  cameraAfterPinchScale,
  cameraAfterWheel,
  cameraAfterZoomStep,
  frameChromeLayout,
  frameChromeMetrics,
  frameUiScale,
  frameToolbarMode,
  wheelDestination
} from "../../src/react/canvas-viewport.js"
import { CanvasSelection, resizeGeometry } from "../../src/react/canvas-selection.js"
import {
  PAN_CANVAS_CURSOR,
  PANNING_CANVAS_CURSOR,
  SELECT_CANVAS_CURSOR,
  canvasCursor
} from "../../src/react/canvas-cursors.js"
import { critStyles } from "../../src/react/crit-styles.js"
import { FRAME_STATUSES } from "../../src/react/frame-chrome.js"
import { resizeCursors } from "../../src/react/resize-cursors.js"
import { MOVE_CANVAS_CURSOR } from "../../src/react/move-cursor.js"
import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { Effect } from "effect"

describe("Crit", () => {
  it("ships the established dev-canvas visual contract with the component", () => {
    expect(critStyles).toContain("--crit-ink: #191918")
    expect(critStyles).toContain("--crit-accent: #ff5c35")
    expect(critStyles).toContain(".crit-toolbar")
    expect(critStyles).toContain(".crit-status-option")
    expect(critStyles).toContain(".crit-selection__handle")
    expect(critStyles).toContain(".crit-canvas__pan-shield")
    expect(critStyles).toContain("crit-tooltip-content-in-from-right")
    expect(critStyles).toContain('[data-activation-direction~="left"]')
    expect(critStyles).not.toContain(".crit-resize-handle")
    expect(critStyles).not.toContain(".crit-frame__more")
    expect(critStyles).not.toContain("#e8ebef")
  })

  it("uses the supplied pointer and hand artwork for canvas tools", () => {
    expect(canvasCursor("select")).toBe(SELECT_CANVAS_CURSOR)
    expect(canvasCursor("pan")).toBe(PAN_CANVAS_CURSOR)
    expect(canvasCursor("pan", true)).toBe(PANNING_CANVAS_CURSOR)
    expect(SELECT_CANVAS_CURSOR).toContain(") 8 8, default")
    expect(PAN_CANVAS_CURSOR).toContain(") 16 16, grab")
    expect(PANNING_CANVAS_CURSOR).toContain(") 16 16, grabbing")
  })

  it("renders resize cursors at the same 32px canvas size as other tools", () => {
    for (const cursor of Object.values(resizeCursors)) {
      expect(decodeURIComponent(cursor)).toContain('width="32" height="32"')
      expect(cursor).toContain(") 16 16,")
    }
  })

  it("uses the supplied four-way move cursor on draggable headers", () => {
    expect(decodeURIComponent(MOVE_CANVAS_CURSOR)).toContain(
      'width="32" height="32"'
    )
    expect(MOVE_CANVAS_CURSOR).toContain(") 16 16, move")
    expect(critStyles.split(MOVE_CANVAS_CURSOR)).toHaveLength(3)
  })

  it("keeps wheel zoom on the canvas and anchored beneath the pointer", () => {
    const current = { x: 10, y: 20, zoom: 1 }
    const pointer = { clientX: 110, clientY: 220 }
    const next = cameraAfterWheel(current, {
      ...pointer,
      ctrlKey: true,
      metaKey: false,
      deltaX: 0,
      deltaY: -100
    }, { left: 10, top: 20 })

    expect(next.zoom).toBeGreaterThan(current.zoom)
    expect((100 - next.x) / next.zoom).toBeCloseTo(90)
    expect((200 - next.y) / next.zoom).toBeCloseTo(180)
    expect(cameraAfterWheel(current, {
      ...pointer,
      ctrlKey: false,
      metaKey: false,
      deltaX: 12,
      deltaY: -8
    }, { left: 10, top: 20 })).toEqual({ x: -2, y: 28, zoom: 1 })
  })

  it("keeps plain frame-content scrolling in the frame while routing zoom to the canvas", () => {
    expect(wheelDestination({ ctrlKey: false, metaKey: false }, true)).toBe("frame")
    expect(wheelDestination({ ctrlKey: false, metaKey: false }, false)).toBe("canvas")
    expect(wheelDestination({ ctrlKey: true, metaKey: false }, true)).toBe("canvas")
    expect(wheelDestination({ ctrlKey: false, metaKey: true }, true)).toBe("canvas")
  })

  it("maps native touchpad pinch scale to the canvas around its focal point", () => {
    const current = { x: 40, y: 50, zoom: 0.65 }
    const next = cameraAfterPinchScale(current, 1.25, { x: 420, y: 260 })

    expect(next.zoom).toBeCloseTo(0.8125)
    expect((420 - next.x) / next.zoom).toBeCloseTo((420 - current.x) / current.zoom)
    expect((260 - next.y) / next.zoom).toBeCloseTo((260 - current.y) / current.zoom)
  })

  it("defines global tool and zoom shortcuts for TanStack Hotkeys", () => {
    expect(CRIT_HOTKEYS).toEqual({
      selectTool: "V",
      handTool: "H",
      zoomIn: [
        { key: "=", mod: true },
        { key: "=", mod: true, shift: true }
      ],
      zoomOut: [
        { key: "-", mod: true },
        { key: "-", mod: true, shift: true }
      ]
    })
  })

  it("zooms by keyboard around the canvas center", () => {
    const current = { x: 100, y: 80, zoom: 0.5 }
    const next = cameraAfterZoomStep(current, 1, { width: 1200, height: 800 })

    expect(next.zoom).toBeGreaterThan(current.zoom)
    expect((600 - next.x) / next.zoom).toBeCloseTo((600 - current.x) / current.zoom)
    expect((400 - next.y) / next.zoom).toBeCloseTo((400 - current.y) / current.zoom)
  })

  it("resizes from every selected edge while anchoring the opposite edge", () => {
    const geometry = { x: 100, y: 200, width: 400, height: 300 }

    expect(resizeGeometry(geometry, "north-west", 50, 40)).toEqual({
      x: 150, y: 240, width: 350, height: 260
    })
    expect(resizeGeometry(geometry, "south-east", 50, 40)).toEqual({
      x: 100, y: 200, width: 450, height: 340
    })
    expect(resizeGeometry(geometry, "west", 500, 0)).toEqual({
      x: 320, y: 200, width: 180, height: 300
    })
  })

  it("shows four corner handles with invisible edge resize targets", () => {
    const html = renderToStaticMarkup(
      <CanvasSelection ink="#123456" label="Candidate" onResize={() => {}} zoom={0.5} />
    )

    expect(html.match(/data-resize-handle=/g)).toHaveLength(8)
    expect(html.match(/data-visible-handle=/g)).toHaveLength(4)
    expect(html).toContain("Selected Candidate")
    expect(html).toContain("--selection-ui:2")
    expect(critStyles).toContain("data:image/svg+xml")
    expect(critStyles).toContain("nwse-resize")
    expect(critStyles).toContain("nesw-resize")
    expect(critStyles).toContain("ew-resize")
    expect(critStyles).toContain("ns-resize")
  })

  it("includes archive in the original status sequence", () => {
    expect(FRAME_STATUSES.map((status) => status.id)).toEqual([
      "changes-requested",
      "in-progress",
      "archived",
      "approved",
      "ready-for-review"
    ])
  })

  it("keeps the title until fewer than ten characters fit", () => {
    expect(frameToolbarMode(223)).toBe("full")
    expect(frameToolbarMode(222)).toBe("compact")
    expect(frameToolbarMode(151)).toBe("minimal")
  })

  it("progressively hides Frame actions only when their width budget runs out", () => {
    expect(DEFAULT_FRAME_CHROME_SETTINGS).toEqual({
      titleMinimumCharacters: 10,
      snapshotMinimumWidth: 148,
      openMinimumWidth: 82,
      fullscreenMinimumWidth: 104,
      deleteMinimumWidth: 60
    })
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

  it("defines the frame screen-size presets as exact resize targets", () => {
    expect(FRAME_SIZE_PRESETS).toEqual([
      { id: "mobile", label: "Mobile", width: 402, height: 874 },
      { id: "tablet", label: "Tablet", width: 832, height: 1194 },
      { id: "laptop", label: "Laptop", width: 1280, height: 832 },
      { id: "desktop", label: "Desktop", width: 1512, height: 982 },
      { id: "widescreen", label: "Widescreen", width: 2560, height: 1440 }
    ])
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
    expect(html).toContain('data-frame-status="ready-for-review"')
    expect(html).toContain('class="crit-toolbar"')
    expect(html).toContain('class="crit-frame"')
    expect(html).toContain('class="crit-note"')
    expect(html).toContain("Status: Approved. Change status")
    expect(html).toContain("A: Candidate")
    expect(html).toContain("Attached to candidate")
    expect(html).toContain("Tighten spacing")
    expect(html).toContain("Send note to back")
    expect(html).toContain("Bring note to front")
    expect(html).not.toContain("Layer options for Candidate")
    expect(html).not.toContain("crit-frame__select-shield")
    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('aria-keyshortcuts="V"')
    expect(html).toContain('aria-keyshortcuts="H"')
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
