import { Popover } from "@base-ui/react/popover"
import { spring } from "motion"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Crit, sessionIdForCanvas } from "../../src/react/crit.js"
import {
  CanvasPresenceIndicator,
  GitIdentityBoundary
} from "../../src/react/canvas-feedback.js"
import { GIT_AUTHOR_REMEDIATION_PROMPT } from "../../src/runtime/author-identity.js"
import {
  actionHelpDetails,
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
import {
  frameContentProjection,
  statusFanProjection
} from "../../src/react/frame-card.js"
import {
  COMMENT_POPOVER_GAP,
  COMMENT_POPOVER_WIDTH,
  CommentPopover,
  commentPopoverProjection
} from "../../src/react/comment-popover.js"
import { CanvasCommentPin } from "../../src/react/canvas-comment-pin.js"
import {
  advanceContextMenuDismissal,
  contextMenuIsOpen,
  CritContextActions,
  type ContextMenuItem
} from "../../src/react/canvas-context-menu.js"
import { critStyles } from "../../src/react/crit-styles.js"
import { CanvasSelection } from "../../src/react/canvas-selection.js"
import {
  FRAME_STATUSES,
  STATUS_PILL_HEIGHT,
  STATUS_PILL_MOTION,
  STATUS_PILL_STEP,
  calculateStatusFanLayout,
  calculateStatusPillLayout,
  frameStatusMenuOptions,
  measureStatusPillWidth,
  statusPillFrameGap,
  statusPillMotionPath
} from "../../src/react/frame-chrome.js"
import {
  arrangementMenuAnchorRect,
  CanvasToolbar
} from "../../src/react/canvas-toolbar.js"
import { CanvasActionRunnerProvider } from "../../src/react/canvas-action-runner.js"
import { CanvasControls } from "../../src/react/canvas-controls.js"
import {
  blurNoteEditorOnSurfacePress,
  listenForNoteEditorBlur,
  NoteCard,
  NOTE_INTERACTION_BAND_HEIGHT,
  NOTE_MINIMUM_ROWS,
  noteContextMenuItems,
  noteHeightForContent
} from "../../src/react/note-card.js"
import { Canvas, CanvasCommand } from "../../src/core/index.js"
import { Effect } from "effect"

const cssRule = (selector: string) => {
  const start = critStyles.indexOf(`${selector} {`)
  if (start < 0) return ""
  const end = critStyles.indexOf("}", start)
  return critStyles.slice(start, end + 1)
}

describe("Crit", () => {
  it("creates a session ID when randomUUID is unavailable on an HTTP origin", () => {
    const sessionId = sessionIdForCanvas("mobile", {
      now: () => 123,
      randomUUID: () => undefined,
      random: () => 0.5,
      sessionStorage: () => undefined
    })

    expect(sessionId).toMatch(/^session-123-/)
  })

  it("renders the supplied two-tone SVG in all four frame corners", () => {
    const html = renderToStaticMarkup(
      <CanvasSelection
        ink="rebeccapurple"
        label="frame"
        onResize={() => {}}
        shell="lavender"
        zoom={1}
      />
    )
    expect(html.match(/<svg/g)).toHaveLength(4)
    expect(html).toContain('viewBox="0 0 13.95 13.95"')
    expect(html.match(/crit-selection__handle-isolation/g)).toHaveLength(4)
    expect(html.match(/crit-selection__handle-accent/g)).toHaveLength(4)
    expect(html).toContain("--selection-ink:rebeccapurple")
    expect(html).toContain("--selection-handle-accent:lavender")
    expect(html).toContain("--selection-handle-offset:4.95")
    expect(html).toContain("M12.95,3.95C7.98,3.95,3.95,7.98,3.95,12.95")
  })

  it("renders the supplied status-colored side handles for notes", () => {
    const html = renderToStaticMarkup(
      <CanvasSelection
        handleStyle="sides"
        ink="rebeccapurple"
        label="note"
        onResize={() => {}}
        shell="lavender"
        zoom={1}
      />
    )
    expect(html.match(/crit-selection__side-handle-shape/g)).toHaveLength(2)
    expect(html).toContain('data-handle-style="sides"')
    expect(html).toContain('viewBox="0 0 4.95 18"')
    expect(html).toContain("M2.95,1h1v16h-1Z")
    expect(html).toContain("--selection-ink:rebeccapurple")
    expect(html).toContain("--selection-handle-accent:lavender")
    expect(html).not.toContain('viewBox="0 0 13.95 13.95"')
  })

  it("renders the shared canvas toolbar contract", () => {
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <CanvasToolbar
          canvasChoices={[
            { id: "feature-lab", title: "Feature lab" },
            { id: "checkout", title: "Checkout review" }
          ]}
          canvasId="feature-lab"
          commentAvailable
          noteAvailable
          onAction={() => {}}
          onCanvasSelect={() => {}}
          selectedItemCount={3}
          title="Feature lab"
          trailingControls={(
            <CanvasPresenceIndicator
              presence={{
                currentAuthor: { id: "git:willa", name: "Willa King" },
                availability: "available",
                activities: []
              }}
            />
          )}
          tool="select"
        />
      </CanvasActionRunnerProvider>
    )

    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-orientation="horizontal"')
    expect(html.match(/role="group"/g)).toHaveLength(2)
    expect(html).toContain("Feature lab")
    expect(html).toContain('data-crit-help-name="Change canvas"')
    expect(html).toContain(
      'data-crit-help-description="Choose a different canvas."'
    )
    expect(html).toContain('aria-label="Change canvas"')
    expect(html).not.toContain('aria-label="More canvas actions"')
    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('aria-label="Align and distribute"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-pressed="true"')
    expect(html.match(/role="separator"/g)).toHaveLength(3)
    expect(html).toContain('aria-label="Canvas presence: 1"')
    expect(html.indexOf('aria-label="Canvas presence: 1"')).toBeGreaterThan(
      html.indexOf('aria-label="Add comment"')
    )
    const undoButton = html.match(
      /<button[^>]*aria-label="Undo"[^>]*>/
    )?.[0]
    expect(undoButton).toContain('aria-disabled="true"')
    expect(undoButton).not.toContain('disabled=""')
    expect(html).not.toContain("Layers")
  })

  it("anchors the arrangement menu below the whole toolbar", () => {
    const anchor = arrangementMenuAnchorRect(
      {
        bottom: 32,
        height: 24,
        left: 208,
        right: 232,
        top: 8,
        width: 24,
        x: 208,
        y: 8
      },
      {
        bottom: 40,
        height: 40,
        left: 0,
        right: 315,
        top: 0,
        width: 315,
        x: 0,
        y: 0
      }
    )

    expect(anchor).toMatchObject({
      bottom: 40,
      height: 40,
      left: 208,
      right: 232,
      top: 0,
      width: 24,
      x: 208,
      y: 0
    })
  })

  it("sizes the canvas toolbar from its title and controls", () => {
    const toolbar = cssRule(".crit-toolbar")
    const title = cssRule(".crit-toolbar__title")
    const titleButton = cssRule("button.crit-toolbar__title")
    const canvasMenu = cssRule(".crit-canvas-switcher")
    const canvasMenuItem = cssRule(".crit-canvas-switcher__item")
    const group = cssRule(".crit-toolbar__group")
    const iconButton = cssRule(".crit-icon-button")
    const hitExtension = cssRule(
      ".crit-toolbar__group .crit-icon-button::before"
    )
    const arrangementPopover = cssRule(".crit-arrangement-popover")

    expect(toolbar).toContain("width: max-content")
    expect(toolbar).toContain("max-width: 100%")
    expect(toolbar).toContain("left: 0")
    expect(toolbar).toContain("top: 0")
    expect(toolbar).toContain("border-radius: 0 0 8px 0")
    expect(toolbar).toContain(
      "font-family: InterVariable, Inter, sans-serif"
    )
    expect(toolbar).toContain(
      'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1'
    )
    expect(toolbar).toContain("font-optical-sizing: none")
    expect(toolbar).toContain('font-variation-settings: "opsz" 14')
    expect(toolbar).toContain("letter-spacing: 0")
    expect(toolbar).not.toContain("width: 395px")
    expect(title).toContain("flex: 0 1 auto")
    expect(title).not.toContain("142px")
    expect(titleButton).toContain("font-size: 14px")
    expect(titleButton).toContain("line-height: 16px")
    expect(titleButton).toContain("letter-spacing: 0")
    expect(canvasMenu).toContain(
      "font-family: InterVariable, Inter, sans-serif"
    )
    expect(canvasMenu).toContain("letter-spacing: 0")
    expect(canvasMenuItem).toContain(
      "font: 500 12px/16px InterVariable, Inter, sans-serif"
    )
    expect(canvasMenuItem).toContain(
      'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1'
    )
    expect(canvasMenuItem).toContain("font-optical-sizing: none")
    expect(canvasMenuItem).toContain('font-variation-settings: "opsz" 14')
    expect(canvasMenuItem).toContain("letter-spacing: 0")
    expect(group).toContain("gap: 6px")
    expect(iconButton).toContain("height: 24px")
    expect(iconButton).toContain("width: 24px")
    expect(hitExtension).toContain('content: ""')
    expect(hitExtension).toContain("inset: 0 -3px")
    expect(arrangementPopover).toContain(
      "background: oklch(97% 0.001 106.4)"
    )
    expect(arrangementPopover).toContain("border-radius: 8px")
    expect(arrangementPopover).toContain(
      "oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px"
    )
    expect(arrangementPopover).not.toContain("border-top")
    expect(critStyles).not.toContain(
      ".crit-arrangement-popover__grid--distribution {"
    )
  })

  it("keeps the title until fewer than ten characters fit", () => {
    expect(frameToolbarMode(223)).toBe("full")
    expect(frameToolbarMode(222)).toBe("compact")
    expect(frameToolbarMode(151)).toBe("minimal")
  })

  it("progressively hides Frame actions only when their width budget runs out", () => {
    expect(frameChromeLayout(150, 1, true).actions).toEqual({
      snapshot: true,
      breakpoints: false,
      open: true,
      fullscreen: true,
      delete: true
    })
    expect(frameChromeLayout(120, 1, true).actions).toEqual({
      snapshot: false,
      breakpoints: false,
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
    expect(frameChromeLayout(250, 1, true).titleVisible).toBe(true)
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

  it("uses Inter with stable Frame header metrics", () => {
    expect(critStyles).toContain(
      '@import url("https://rsms.me/inter/inter.css");'
    )
    const chrome = cssRule(".crit-frame__chrome")
    const titleLine = cssRule(".crit-frame__title-track strong")

    expect(chrome).toContain("font-family: InterVariable, Inter, sans-serif")
    expect(chrome).toContain(
      'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1'
    )
    expect(chrome).toContain("font-optical-sizing: none")
    expect(chrome).toContain('font-variation-settings: "opsz" 14')
    expect(titleLine).not.toContain("system-ui")
  })

  it("uses the Frame palette selected in the UI lab", () => {
    expect(FRAME_STATUSES.map(({ id, shell, stroke, ink }) => ({
      id,
      shell,
      stroke,
      ink
    }))).toEqual([
      {
        id: "changes-requested",
        shell: "oklch(95.25% 0.024 55)",
        stroke: "oklch(67% 0.18 55)",
        ink: "oklch(52% 0.2 55)"
      },
      {
        id: "in-progress",
        shell: "oklch(95.25% 0.024 245.3)",
        stroke: "oklch(67% 0.18 245.3)",
        ink: "oklch(52% 0.2 245.3)"
      },
      {
        id: "archived",
        shell: "oklch(95.25% 0 none)",
        stroke: "oklch(67% 0 none)",
        ink: "oklch(28% 0 none)"
      },
      {
        id: "approved",
        shell: "oklch(95.25% 0.024 156.3)",
        stroke: "oklch(67% 0.18 156.3)",
        ink: "oklch(52% 0.2 156.3)"
      },
      {
        id: "ready-for-review",
        shell: "oklch(95.25% 0.024 302)",
        stroke: "oklch(67% 0.18 302)",
        ink: "oklch(52% 0.2 302)"
      }
    ])
    expect(cssRule(".crit-frame__viewport")).toContain(
      "background: var(--crit-frame-viewport-surface, oklch(99% 0 none))"
    )
    expect(cssRule(".crit-selection__handle[data-visible-handle]")).toContain(
      "height: calc(var(--selection-handle-size) * var(--selection-ui) * 1px)"
    )
  })

  it("keeps snapshot capture out of the live frame status menu", () => {
    expect(frameStatusMenuOptions("approved").map(({ id }) => id)).toEqual([
      "changes-requested",
      "in-progress",
      "ready-for-review"
    ])
  })

  it("moves status options along the fan arc in both directions", () => {
    const target = {
      startY: 198,
      finalX: -48,
      finalY: -12,
      finalRotate: -28
    }
    const path = statusPillMotionPath(target)

    expect(path.enter.x[0]).toBe(0)
    expect(path.enter.y[0]).toBe(target.startY)
    expect(path.enter.rotate[0]).toBe(0)
    expect(path.enter.x.at(-1)).toBe(target.finalX)
    expect(path.enter.y.at(-1)).toBe(target.finalY)
    expect(path.enter.rotate.at(-1)).toBe(target.finalRotate)
    expect(path.enter.x[3]).not.toBeCloseTo(target.finalX * path.times[3]!)
    expect(path.exit.x).toEqual([...path.enter.x].reverse())
    expect(path.exit.y).toEqual([...path.enter.y].reverse())
    expect(path.exit.rotate).toEqual([...path.enter.rotate].reverse())
    expect(STATUS_PILL_MOTION.spring.type).toBe("spring")
    expect(STATUS_PILL_MOTION.spring.visualDuration).toBeLessThan(0.2)
  })

  it("uses a monotonic spring that cannot overshoot the status arc", () => {
    const generator = spring({
      ...STATUS_PILL_MOTION.spring,
      keyframes: [0, 1]
    })
    const progress = Array.from(
      { length: 41 },
      (_, index) => generator.next(index * 10).value
    )

    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(progress.every((value, index) =>
      index === 0 || value >= progress[index - 1]!
    )).toBe(true)
  })

  it("keeps every status coordinate monotonic from its header origin", () => {
    const isMonotonic = (values: ReadonlyArray<number>) => {
      const direction = Math.sign(values.at(-1)! - values[0]!)
      return values.every((value, index) =>
        index === 0 || direction * (value - values[index - 1]!) >= 0
      )
    }

    for (const current of FRAME_STATUSES) {
      const options = frameStatusMenuOptions(current.id)
      const layout = calculateStatusPillLayout(
        options.map((option) => measureStatusPillWidth(option.label))
      )
      for (const item of layout) {
        const startY =
          item.distanceFromFrame * STATUS_PILL_STEP +
          STATUS_PILL_MOTION.originOffset
        const path = statusPillMotionPath({
          startY,
          finalX: item.finalX,
          finalY: item.finalY,
          finalRotate: item.finalRotate
        })

        expect(isMonotonic(path.enter.x)).toBe(true)
        expect(isMonotonic(path.enter.y)).toBe(true)
        expect(isMonotonic(path.enter.rotate)).toBe(true)
        expect(path.enter.x.at(-1)).toBeCloseTo(item.finalX)
        expect(path.enter.y.at(-1)).toBeCloseTo(item.finalY)
        expect(path.enter.rotate.at(-1)).toBeCloseTo(item.finalRotate)
      }
    }
  })

  it("measures status pills with the same deterministic heuristic everywhere", () => {
    expect(measureStatusPillWidth("Approved")).toBe(92)
    expect(measureStatusPillWidth("Ready for review")).toBe(144)
  })

  it("keeps iframe viewport geometry independent from the Canvas shell zoom", () => {
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const projection = frameContentProjection(402, 874, zoom)

      expect(projection.iframeWidth).toBe(402)
      expect(projection.iframeHeight).toBe(874)
      expect(projection.shellWidth * zoom).toBeCloseTo(402 * zoom)
      expect(projection.shellHeight * zoom).toBeCloseTo(874 * zoom + 28)
    }
    const iframe = cssRule(".crit-frame__viewport iframe")
    expect(iframe).toContain("height: 100%")
    expect(iframe).toContain("width: 100%")
    expect(iframe).not.toContain("transform:")
  })

  it("matches the neutral segmented drag-selection marquee", () => {
    const marquee = cssRule(".crit-canvas__selection-marquee")

    expect(marquee).toContain(
      "var(--crit-color-p2, oklch(65% 0 none)) 10%"
    )
    expect(marquee).toContain(
      "--crit-selection-marquee-ink: var(--crit-color-t1, oklch(52% 0 none))"
    )
    expect(marquee).toContain("background-size:")
    expect(marquee).toContain(
      "var(--crit-selection-marquee-ink) 0 9px, transparent 9px 12px"
    )
    expect(marquee).toContain("100% 1px")
    expect(marquee).toContain("1px 100%")
    expect(marquee).toContain(
      "calc(100% - 8px) calc(100% - 8px)"
    )
    expect(marquee).toContain("4px 4px")
    expect(marquee).not.toContain("border:")
  })

  it("keeps the frame-local status fan at header scale", () => {
    expect(statusFanProjection(8)).toEqual({
      scale: 1,
      frameGap: 8
    })
    expect(statusFanProjection(8, 0.5)).toEqual({
      scale: 0.5,
      frameGap: 4
    })
  })

  it("keeps every rotated status fan visually separated from its header", () => {
    for (const current of FRAME_STATUSES) {
      const options = frameStatusMenuOptions(current.id)
      const layout = calculateStatusPillLayout(
        options.map((option) => measureStatusPillWidth(option.label))
      )
      const bottom = layout.at(-1)
      expect(bottom).toBeDefined()
      const rotatedOverflow = Math.max(
        0,
        bottom!.verticalHalfExtent - STATUS_PILL_HEIGHT / 2
      )
      const projection = statusFanProjection(statusPillFrameGap(bottom))

      expect(projection.frameGap - rotatedOverflow).toBeCloseTo(
        STATUS_PILL_MOTION.gap
      )
    }
  })

  it("derives a complete, stable fan for changing item counts", () => {
    for (let count = 1; count <= 8; count += 1) {
      const options = Array.from({ length: count }, (_, index) => ({
        label: `Status ${"wide ".repeat(index + 1)}`.trim()
      }))
      const fan = calculateStatusFanLayout(options)
      const collapsedOrigins = fan.items.map((item, index) =>
        index * STATUS_PILL_STEP + item.startY
      )

      expect(fan.items).toHaveLength(count)
      expect(new Set(collapsedOrigins.map(Math.round))).toHaveLength(1)
      expect(fan.frameGap).toBeGreaterThanOrEqual(STATUS_PILL_MOTION.gap)
      for (const [index, item] of fan.items.entries()) {
        expect(item.option).toBe(options[index])
        expect(item.width).toBe(measureStatusPillWidth(options[index]!.label))
        expect([
          item.finalX,
          item.finalY,
          item.finalRotate,
          item.startY
        ].every(Number.isFinite)).toBe(true)
      }
    }
  })

  it("keeps comment threads fixed-size and directly left of their frame", () => {
    const frame = { x: 800, y: 120, width: 600, height: 480, zIndex: 2 }
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const projection = commentPopoverProjection(frame, zoom)

      expect(projection.scale * zoom).toBeCloseTo(1)
      expect((frame.x - projection.left) * zoom).toBeCloseTo(
        COMMENT_POPOVER_WIDTH + COMMENT_POPOVER_GAP
      )
      expect(projection.top).toBe(frame.y)
    }
  })

  it("renders an existing Comment Thread read-only without a Current Author", () => {
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider><CommentPopover
        canSubmit={false}
        clearDraft={null}
        currentAuthorId={null}
        frameId="candidate"
        inline
        pending={false}
        statusColor="rebeccapurple"
        threadManageable={false}
        thread={{
          id: "thread-1",
          frameId: "candidate",
          anchor: { kind: "frame", xRatio: 0.5, yRatio: 0.5 },
          opening: {
            id: "comment-1",
            body: "Tighten this spacing",
            author: { id: "git-alice", name: "Alice" },
            createdAt: "2026-08-11T12:00:00.000Z",
            editedAt: null
          },
          replies: [],
          resolvedAt: null,
          resolvedBy: null
        }}
        onClose={() => Effect.void}
        onDraftStatus={() => {}}
        onEdit={() => Effect.void}
        onResolve={() => Effect.void}
        onSubmit={() => Effect.void}
      /></CanvasActionRunnerProvider>
    )

    expect(html).toContain("Tighten this spacing")
    expect(html).not.toContain('aria-label="Reply"')
    expect(html).not.toContain(">Edit</button>")
  })

  it("keeps the bare comment pin stable through canvas zoom", () => {
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider><CanvasCommentPin
        active
        authorName="Wes"
        color="rebeccapurple"
        onOpen={() => Effect.void}
        threadId="thread-1"
        xRatio={0.5}
        yRatio={0.5}
        zoom={0.5}
      /></CanvasActionRunnerProvider>
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-active="true"')
    expect(html).toContain('--crit-ui:2')
    expect(cssRule(".crit-comment-pin")).toContain("background: transparent")
    expect(cssRule(".crit-comment-pin")).toContain("border: 0")
    expect(cssRule(".crit-comment-pin")).toContain("box-shadow: none")
    expect(cssRule(".crit-comment-pin svg")).toContain(
      "height: calc(18px * var(--crit-ui))"
    )
    expect(critStyles).not.toContain(".crit-comment-pin::after")
  })

  it("composes Canvas comment pins with the shared Popover root", () => {
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <Popover.Root
          open
          triggerId="crit-comment-trigger-thread-1"
        >
          <CanvasCommentPin
            active
            authorName="Wes"
            color="rebeccapurple"
            onOpen={() => Effect.void}
            popoverTrigger
            threadId="thread-1"
            xRatio={0.5}
            yRatio={0.5}
            zoom={1}
          />
        </Popover.Root>
      </CanvasActionRunnerProvider>
    )

    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('id="crit-comment-trigger-thread-1"')
    expect(html).toContain('aria-expanded="true"')
  })

  it("matches the wking Frame shell, chrome, and viewport treatment", () => {
    const surface = cssRule(".crit-frame__surface")
    const chrome = cssRule(".crit-frame__chrome")
    const viewport = cssRule(".crit-frame__viewport")

    expect(surface).toContain("display: flex")
    expect(surface).toContain("flex-direction: column")
    expect(surface).toContain(
      "box-shadow: var(--frame-stroke) 0 0 0 calc(.5px * var(--crit-ui))"
    )
    expect(cssRule(".crit-frame__surface::before")).toContain("z-index: 3")
    expect(chrome).toContain("flex: 0 0 var(--crit-frame-chrome-height)")
    expect(chrome).toContain("z-index: 2")
    expect(cssRule(".crit-frame__actions")).toContain("gap: 0")
    expect(cssRule(".crit-frame__actions")).toContain(
      "margin-inline: calc(-3px * var(--crit-ui))"
    )
    expect(critStyles).toContain(
      ".crit-frame__action {\n  flex-basis: calc(22px * var(--crit-ui));\n  height: var(--crit-frame-chrome-height);\n  padding: calc(6px * var(--crit-ui)) calc(3px * var(--crit-ui));\n  width: calc(22px * var(--crit-ui));\n}"
    )
    expect(viewport).toContain("flex: 1")
    expect(viewport).toContain("min-height: 0")
    expect(critStyles).toContain("transform: scale(1.08)")
    expect(critStyles).toContain(
      '.crit-frame__title-mask[data-editing="true"] { mask-image: none; }'
    )
    expect(cssRule(".crit-frame__viewport iframe")).toContain(
      "position: absolute"
    )
  })

  it("renders its loading boundary with the default HTTP client", () => {
    const html = renderToStaticMarkup(<Crit canvasId="homepage" />)

    expect(html).toContain("Opening canvas…")
  })

  it("hides inactive help and emits complete details for canvas controls", () => {
    const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
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
    expect(html).not.toContain('aria-label="More canvas actions"')
    expect(html).toContain('aria-label="Canvas options"')
    expect(html).toContain('data-crit-help-name="Canvas options"')
    expect(html).toContain(
      'data-crit-help-description="Rename this canvas."'
    )
    expect(html).toContain('data-crit-help-name="Select"')
    expect(html).toContain('data-crit-help-shortcut="V"')
    expect(html).toContain(
      'data-crit-help-description="Drag empty canvas to select multiple Frames and Notes; hold Shift or Cmd/Ctrl to add to the selection."'
    )
    expect(html).toContain('data-crit-help-name="Add frame"')
    expect(html).toContain('data-crit-help-name="Add note"')
    expect(html).toContain('data-crit-help-shortcut="F"')
    expect(html).toContain('data-crit-help-shortcut="N"')
    expect(html).not.toContain("crit-tooltip")

    expect(html).toContain('data-crit-help-kind="action"')
    expect(html).toContain('data-crit-help-kind="informational"')
    expect(html.match(/data-crit-help-name=/g)?.length).toBe(
      html.match(/data-crit-help-description=/g)?.length
    )
  })

  it("renders help using the canvas-corner treatment and shared text styles", () => {
    const html = renderToStaticMarkup(
      <CanvasHelpPanel details={actionHelpDetails(CanvasControls.resolve({
          platform: "macos",
          activeScopes: ["canvas"],
          globalFacts: { commentAuthorPresent: true },
          pendingActions: []
        }).action({ id: "open-new-frame" }))} />
    )

    expect(html).toContain('class="crit-help__title"')
    expect(html).toContain('class="crit-help__shortcut"')
    expect(html).toContain('class="crit-help__description"')
    expect(html).not.toContain(">Name<")
    expect(html).not.toContain(">Hotkey<")
    expect(html).not.toContain(">Description<")
    expect(html).not.toContain("<kbd")
    const help = cssRule(".crit-help")
    const title = cssRule(".crit-help__title")
    const shortcut = cssRule(".crit-help__shortcut")
    const description = cssRule(
      ".crit-help__description, .crit-help__availability"
    )

    expect(help).toContain("border-radius: 0 8px 0 0")
    expect(help).toContain("bottom: 0")
    expect(help).toContain("box-sizing: border-box")
    expect(help).toContain("left: 0")
    expect(help).toContain("align-content: start")
    expect(help).toContain("min-height: 92px")
    expect(help).toContain("padding: 10px 12px 14px 14px")
    expect(help).toContain("width: 335px")
    expect(help).toContain("font-family: InterVariable, Inter, sans-serif")
    expect(help).toContain(
      'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1'
    )
    expect(help).toContain("font-optical-sizing: none")
    expect(help).toContain('font-variation-settings: "opsz" 14')
    expect(help).toContain("letter-spacing: 0")
    expect(title).toContain("font: 400 14px/20px InterVariable, Inter")
    expect(title).toContain(
      'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1'
    )
    expect(title).toContain("font-optical-sizing: none")
    expect(title).toContain('font-variation-settings: "opsz" 14')
    expect(title).toContain("letter-spacing: 0")
    expect(title).toContain("var(--crit-color-t2, oklch(28% 0 0))")
    expect(shortcut).toContain("border-radius: 2px")
    expect(shortcut).toContain("box-sizing: border-box")
    expect(shortcut).toContain('font: 400 12px/20px "Geist Mono"')
    expect(shortcut).toContain("height: 20px")
    expect(shortcut).not.toContain("min-width")
    expect(shortcut).toContain("padding: 0 8px")
    expect(shortcut).toContain("position: relative")
    expect(shortcut).toContain("top: 1px")
    expect(description).toContain("font: 400 14px/20px InterVariable, Inter")
    expect(description).toContain(
      'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1'
    )
    expect(description).toContain("font-optical-sizing: none")
    expect(description).toContain('font-variation-settings: "opsz" 14')
    expect(description).toContain("letter-spacing: 0")
    expect(description).toContain("max-width: 307px")
    expect(description).toContain("var(--crit-color-t1, oklch(52% 0 0))")
  })

  it("describes resize handles through contextual help", () => {
    const html = renderToStaticMarkup(
      <CanvasSelection
        ink="#000"
        label="frame"
        onResize={() => undefined}
        shell="#eee"
        zoom={1}
      />
    )

    expect(html).toContain('data-crit-help-name="Resize"')
    expect(html).toContain(
      'data-crit-help-description="Drag to resize the frame in this direction."'
    )
    expect(html.match(/class="crit-selection__handle"/g)).toHaveLength(8)
    expect(html.match(/data-visible-handle="true"/g)).toHaveLength(4)

  })

  it("keeps Note sizing content-driven and actions in its context menu", () => {
    const controls = CanvasControls.resolve({
      platform: "macos",
      activeScopes: ["canvas", "menu"],
      globalFacts: { commentAuthorPresent: true },
      pendingActions: []
    })
    const target = { kind: "note" as const, id: "feedback", label: "note" }
    const items = noteContextMenuItems({
      controls,
      target,
      currentAuthorIsTargetAuthor: true,
      copyNodeId: Effect.void,
      color: "blue",
      onColor: () => Effect.void,
      onBringToFront: () => Effect.void,
      onRemove: () => Effect.void,
      onSendToBack: () => Effect.void
    })

    expect(NOTE_MINIMUM_ROWS).toBe(3)
    expect(NOTE_INTERACTION_BAND_HEIGHT).toBe(28.5)
    expect(noteHeightForContent(84)).toBe(115)
    expect(items.map((item) => item.action.label)).toEqual([
      "Note color",
      "Bring to front",
      "Send to back",
      "Copy node ID",
      "Delete"
    ])
    const colorItem = items[0]
    expect(colorItem !== undefined && "swatches" in colorItem
      ? colorItem.swatches.map((swatch) => ({
          label: swatch.label,
          selected: swatch.selected
        }))
      : []).toEqual([
      { label: "Neutral", selected: false },
      { label: "Red", selected: false },
      { label: "Orange", selected: false },
      { label: "Green", selected: false },
      { label: "Blue", selected: true },
      { label: "Purple", selected: false }
    ])
    expect(colorItem !== undefined && "swatches" in colorItem
      ? colorItem.swatches.find((swatch) => swatch.selected)
        ?.selectedShadowColor
      : undefined).toBe(
      "var(--crit-color-blue-t2, oklch(28% .1 245.3))"
    )
    expect(cssRule(".crit-context-menu__swatches")).toContain("display: flex")
    expect(cssRule(
      ".crit-context-menu button.crit-context-menu__swatch"
    )).toContain("border-radius: 2px")
    expect(cssRule(
      ".crit-context-menu button.crit-context-menu__swatch[data-selected]"
    )).toContain(
      "box-shadow: 0 0 0 1px var(--crit-swatch-selected-shadow, currentColor)"
    )
    expect(critStyles).not.toContain(
      ".crit-context-menu button.crit-context-menu__swatch:hover"
    )
    const forbiddenItems = noteContextMenuItems({
      controls,
      target,
      currentAuthorIsTargetAuthor: false,
      copyNodeId: undefined,
      color: "blue",
      onColor: () => Effect.void,
      onBringToFront: () => Effect.void,
      onRemove: () => Effect.void,
      onSendToBack: () => Effect.void
    })
    expect(forbiddenItems[0]?.action.availability).toBe("hidden")
    expect(forbiddenItems.map((item) => item.action.label)).not.toContain(
      "Copy node ID"
    )
    expect(forbiddenItems.at(-1)?.action.availability).toBe("hidden")
    expect(cssRule(".crit-note textarea")).toContain("overflow: hidden")
    expect(cssRule(".crit-note textarea")).toContain("min-height:")
    expect(cssRule(".crit-note textarea")).toContain("overflow-wrap: anywhere")
    expect(cssRule(".crit-note textarea")).toContain("text-wrap: pretty")
    expect(cssRule(".crit-note textarea")).toContain(
      "font: 400 calc(14px * var(--crit-ui))/calc(20px * var(--crit-ui)) system-ui, -apple-system, sans-serif"
    )
    expect(cssRule(".crit-note__interaction-band")).toContain(
      "height: var(--crit-note-corner-size)"
    )
    expect(cssRule(".crit-note__interaction-band")).toContain("bottom: 0")
    expect(cssRule(".crit-note__select-shield")).toContain(
      "inset: 0 0 var(--crit-note-corner-size)"
    )
    expect(cssRule(".crit-note::after")).toContain(
      "border: calc(1px * var(--crit-ui)) solid var(--crit-note-outline)"
    )
    expect(cssRule(".crit-note::after")).not.toMatch(
      /box-shadow:[^;]*\binset\b/
    )
    expect(cssRule(".crit-note::after")).not.toContain(
      "color-mix(in oklch, var(--crit-note-pure)"
    )
    expect(cssRule(".crit-note::after")).toContain("-webkit-mask:")
    expect(cssRule(".crit-note::after")).toContain(
      "var(--crit-note-corner-size)"
    )
    expect(cssRule(".crit-note::after")).toContain(
      "+ var(--crit-note-mask-overlap)"
    )
    expect(cssRule(".crit-note__corner")).toContain("bottom: 0")
    expect(cssRule(".crit-note__corner")).toContain("right: 0")
    expect(cssRule(
      ".crit-note[data-selected], .crit-note:focus-visible"
    )).toContain(
      "--crit-note-outline: var(--crit-color-t2, oklch(28% 0 none))"
    )
    expect(cssRule(
      ".crit-note[data-selected], .crit-note:focus-visible"
    )).toContain("outline: 0")
    expect(critStyles).not.toContain(".crit-note__chrome")
    expect(critStyles).not.toContain(".crit-note__more-actions")
    expect(critStyles).not.toContain(".crit-frame__more-actions")
  })

  it("focuses a Note context surface without rendering an ellipsis menu", () => {
    const note = {
      id: "feedback",
      text: "Tighten spacing",
      author: { id: "author", name: "Test Author" },
      geometry: { x: 20, y: 30, width: 240, height: 120 },
      attachedTo: null,
      zIndex: 1,
      color: "blue" as const
    }
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <NoteCard
          author={note.author}
          commit={() => {}}
          execute={() => Effect.void}
          geometry={note.geometry}
          note={note}
          onBringToFront={() => Effect.void}
          onMove={() => {}}
          onSelect={() => {}}
          onSendToBack={() => Effect.void}
          selected
          zoom={1}
        />
      </CanvasActionRunnerProvider>
    )

    const noteSurface = html.match(/<article[^>]*class="crit-note"[^>]*>/)?.[0]
    expect(noteSurface).toContain('data-mode="preview"')
    expect(noteSurface).toContain("width:230px")
    expect(noteSurface).toContain("--crit-ui:1")
    expect(noteSurface).toContain('aria-label="Note actions"')
    expect(noteSurface).toContain('aria-haspopup="menu"')
    expect(noteSurface).toContain(
      'aria-keyshortcuts="Shift+F10 ContextMenu"'
    )
    expect(noteSurface).not.toContain("data-crit-help-name")
    expect(noteSurface).toContain('tabindex="0"')
    expect(html).toContain('class="crit-note__interaction-band"')
    expect(html).toContain('class="crit-note__corner"')
    expect(html).toContain('viewBox="0 0 28.5 28.5"')
    expect(html).toContain('stroke="var(--crit-note-outline)"')
    expect(html).not.toContain('class="crit-selection"')
    expect(html).not.toContain('class="crit-selection__handle"')
    expect(html).not.toContain("More note actions")
  })

  it("blurs a Note editor when its non-text surface is pressed", () => {
    let blurCount = 0
    const textarea = Object.assign(new EventTarget(), {
      blur: () => { blurCount += 1 }
    })

    blurNoteEditorOnSurfacePress(textarea, new EventTarget())
    expect(blurCount).toBe(1)

    blurNoteEditorOnSurfacePress(textarea, textarea)
    expect(blurCount).toBe(1)

    const pointerSource = new EventTarget()
    const stopListening = listenForNoteEditorBlur(pointerSource, textarea)
    pointerSource.dispatchEvent(new Event("pointerdown"))
    expect(blurCount).toBe(2)

    stopListening()
    pointerSource.dispatchEvent(new Event("pointerdown"))
    expect(blurCount).toBe(2)
  })

  it("elevates an expanded Note above the canvas without changing its saved layer", () => {
    const note = {
      id: "feedback",
      text: "",
      author: { id: "author", name: "Test Author" },
      geometry: { x: 20, y: 30, width: 240, height: 120 },
      attachedTo: null,
      zIndex: 1,
      color: "blue" as const
    }
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <NoteCard
          author={note.author}
          commit={() => {}}
          execute={() => Effect.void}
          geometry={note.geometry}
          note={note}
          onBringToFront={() => Effect.void}
          onMove={() => {}}
          onSelect={() => {}}
          onSendToBack={() => Effect.void}
          selected
          topZIndex={9}
          zoom={.35}
        />
      </CanvasActionRunnerProvider>
    )

    const noteSurface = html.match(/<article[^>]*class="crit-note"[^>]*>/)?.[0]
    expect(noteSurface).toContain('data-mode="expanded"')
    expect(noteSurface).toContain("z-index:9")
    expect(note.zIndex).toBe(1)
  })

  it("allows nested context triggers to preserve each item surface", () => {
    const controls = CanvasControls.resolve({
      platform: "macos",
      activeScopes: ["canvas", "menu"],
      globalFacts: { commentAuthorPresent: true },
      pendingActions: []
    })
    const items: ReadonlyArray<ContextMenuItem> = [{
      action: controls.action({ id: "zoom-to-fit" }),
      execute: Effect.void
    }]
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider>
        <CritContextActions ariaLabel="Canvas actions" items={items}>
          <main data-context-surface="canvas">
            <CritContextActions ariaLabel="Frame actions" items={items}>
              <section data-context-surface="frame">Frame</section>
            </CritContextActions>
          </main>
        </CritContextActions>
      </CanvasActionRunnerProvider>
    )

    const canvasSurface = html.match(
      /<main[^>]*data-context-surface="canvas"[^>]*>/
    )?.[0]
    const frameSurface = html.match(
      /<section[^>]*data-context-surface="frame"[^>]*>/
    )?.[0]
    expect(canvasSurface).toContain('aria-label="Canvas actions"')
    expect(frameSurface).toContain('aria-label="Frame actions"')
    for (const surface of [canvasSurface, frameSurface]) {
      expect(surface).toContain('aria-haspopup="menu"')
      expect(surface).toContain(
        'aria-keyshortcuts="Shift+F10 ContextMenu"'
      )
      expect(surface).not.toContain("data-crit-help-name")
      expect(surface).toContain('tabindex="0"')
    }
    expect(html.match(/-webkit-touch-callout:none/g)).toHaveLength(2)
    expect(html).not.toContain("•••")
  })

  it("closes every context menu when the canvas zoom changes", () => {
    const initialDismissal = { revision: 0, signal: 1 }
    const openMenu = { open: true, revision: initialDismissal.revision }

    expect(contextMenuIsOpen(openMenu, initialDismissal.revision)).toBe(true)

    const zoomed = advanceContextMenuDismissal(initialDismissal, 1.25)
    expect(zoomed.revision).toBe(1)
    expect(contextMenuIsOpen(openMenu, zoomed.revision)).toBe(false)

    const returnedToInitialZoom = advanceContextMenuDismissal(zoomed, 1)
    expect(returnedToInitialZoom.revision).toBe(2)
    expect(contextMenuIsOpen(openMenu, returnedToInitialZoom.revision)).toBe(false)
  })

  it("uses compact context-menu spacing and the s1 hover surface", () => {
    const popup = cssRule(".crit-context-menu")
    const item = cssRule(
      ".crit-context-menu button, .crit-context-menu a"
    )

    expect(popup).toContain(
      "font: 500 12px/16px system-ui, -apple-system, sans-serif"
    )
    expect(popup).toContain("gap: 0")
    expect(popup).toContain("padding: 4px")
    expect(popup).toContain("width: 192px")
    expect(item).toContain("height: 28px")
    expect(item).toContain("border: 0")
    expect(item).toContain("box-shadow: none")
    expect(item).toContain("padding: 0 8px")
    expect(cssRule(".crit-context-menu__detail")).toContain("margin-left: 8px")
    expect(cssRule(".crit-context-menu__item[data-highlighted]")).toContain(
      "background: var(--crit-color-s1, oklch(99% 0 none))"
    )
  })

  it("shows only the note glyph in collapsed mode", () => {
    const collapsed = cssRule('.crit-note[data-mode="collapsed"]')

    expect(collapsed).toContain("background: transparent")
    expect(collapsed).toContain("box-shadow: none")
    expect(collapsed).not.toContain("border-radius")
  })

  it("renders Frames and keeps attached Notes visible above the collapse zoom", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
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
      CanvasCommand.addNote({
        id: "feedback",
        text: "Tighten spacing",
        author: { id: "author", name: "Test Author" },
        x: 40,
        y: 50
      }),
      CanvasCommand.attachNote({ id: "feedback", frameId: "candidate" })
    ))

    const html = renderToStaticMarkup(
      <CanvasViewport
        author={{ id: "author", name: "Test Author" }}
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
      />
    )

    expect(html).toContain("Candidate")
    expect(html).toContain("Approved")
    expect(html).toContain("Ready for review")
    expect(html).toContain(
      "--frame-shell:oklch(95.25% 0.024 156.3)"
    )
    expect(html).toContain(
      "--frame-shell:oklch(95.25% 0.024 302)"
    )
    expect(html).not.toContain("--crit-frame-status-")
    expect(html).toContain("Status: Approved. Change status")
    expect(html).toContain("A: Candidate")
    expect(html).toContain("Tighten spacing")
    expect(html).toContain('data-mode="preview"')
    expect(html).not.toContain('aria-label="Expand note"')
    expect(html).not.toContain("Attached to candidate")
    expect(html).toContain('data-crit-help-name="Change frame status"')
    expect(html).not.toContain('data-crit-help-name="Edit title"')
    expect(html).not.toContain('class="crit-frame__title-edit-icon"')
    expect(html).toContain("crit-frame__title-label")
    expect(html).toContain('data-crit-help-name="Edit note"')
    expect(html).not.toContain("More note actions")
    expect(html).not.toContain("More actions for Candidate")
    expect(html).not.toContain("Layer options for Candidate")
    const frameTag = html.match(/<section class="crit-frame"[^>]+>/)?.[0]
    expect(frameTag).toContain(
      `height:${frameContentProjection(1200, 800, 0.65).shellHeight}px`
    )
    const iframeTag = html.match(/<iframe[^>]+candidate[^>]*>/)?.[0]
    expect(iframeTag).not.toContain("style=")
    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('aria-keyshortcuts="V"')
    expect(html).toContain('aria-keyshortcuts="H"')
    expect(html).toContain('aria-keyshortcuts="F"')
    expect(html).toContain('aria-keyshortcuts="N"')
    expect(html).toContain('aria-keyshortcuts="Backspace Delete"')
    expect(html).toContain('aria-label="Select"')
    expect(html).toContain('aria-label="Hand"')
    expect(html.indexOf('aria-label="Select"')).toBeLessThan(
      html.indexOf('aria-label="Hand"')
    )
    const selectButton = html.match(/<button[^>]*aria-label="Select"[^>]*>/)?.[0]
    expect(selectButton).toContain('aria-pressed="true"')

    const collaboratorHtml = renderToStaticMarkup(
      <CanvasViewport
        author={{ id: "collaborator", name: "Collaborator" }}
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
      />
    )
    expect(collaboratorHtml).toContain('data-crit-help-name="Note by Test Author"')
    expect(collaboratorHtml).toContain('readOnly=""')

    const unidentifiedHtml = renderToStaticMarkup(
      <CanvasViewport
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
      />
    )
    const unavailableAddNoteButton = unidentifiedHtml.match(
      /<button[^>]*aria-label="Add note"[^>]*>/
    )?.[0]
    expect(unavailableAddNoteButton).toContain('class="crit-icon-button"')
    expect(unavailableAddNoteButton).toContain('disabled=""')
    const handButton = html.match(/<button[^>]*aria-label="Hand"[^>]*>/)?.[0]
    expect(handButton).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Add frame"')
    expect(html).toContain('aria-label="Add note"')
    const statusTrigger = html.match(
      /<button[^>]*aria-label="Status: Approved\. Change status"[^>]*>/
    )?.[0]
    expect(statusTrigger).toContain('aria-haspopup="menu"')
    expect(statusTrigger).toContain('aria-expanded="false"')
    expect(cssRule(".crit-status-positioner")).toContain("z-index: -1")
    expect(cssRule(".crit-status-menu")).toContain("outline: 0")
    expect(critStyles).toContain(
      ".crit-status-option:hover, .crit-status-option[data-highlighted]"
    )
    expect(critStyles).toMatch(
      /\.crit-frame__surface \{[^}]*z-index: 1;/s
    )
    expect(html).not.toContain("Fit canvas")
    expect(html).not.toContain("Zoom in")
    expect(html).not.toContain("Zoom out")
    expect(html).not.toContain('aria-label="Resize"')
  })

  it("sandboxes archived Frame artifacts while leaving live Frames unsandboxed", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
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
    for (const tag of iframes) {
      expect(tag).toContain('referrerPolicy="no-referrer"')
    }

    const open = html.match(/<a[^>]*href="https:\/\/example\.com\/candidate"[^>]*>/)?.[0]
    expect(open).not.toContain("referrerPolicy")
    expect(open).toContain('rel="noreferrer"')
    expect(open).toContain('target="_blank"')
    expect(html.match(/aria-label="Create breakpoints"/g)).toHaveLength(1)
  })

  it("uses a real relay navigation while preserving the canonical open URL", async () => {
    const canvas = Canvas.create({
      id: "review",
      title: "Review",
      owner: { id: "git:test", name: "Test Author" }
    })
    await Effect.runPromise(Canvas.apply(canvas, CanvasCommand.addFrame({
      id: "candidate",
      url: "/frames/ready#details",
      title: "Candidate",
      provenance: { kind: "manual", sourceId: "test" }
    })))

    const html = renderToStaticMarkup(
      <CanvasViewport
        dispatch={() => Effect.void}
        document={Canvas.export(canvas)}
        frameLoading={{ strategy: "relay" }}
      />
    )

    expect(html).toContain('src="/__crit/frames/review/candidate#details"')
    expect(html).not.toContain("srcDoc=")
    expect(html).toContain('href="/frames/ready#details"')
  })

  it("keeps an explicit iframeSandbox policy for archived Frames", async () => {
    const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
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
    const canvas = Canvas.create({ id: "review", title: "Review", owner: { id: "git:test", name: "Test Author" } })
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

  it("renders keyboard and pointer accessible presence popover triggers", () => {
    const html = renderToStaticMarkup(
      <CanvasPresenceIndicator
        presence={{
          currentAuthor: { id: "git:willa", name: "Willa King" },
          availability: "available",
          activities: [{
            schemaVersion: 1,
            canvasId: "review",
            activityId: "codex-1",
            harness: "Codex",
            model: "GPT-5",
            detail: "Refining checkout",
            reference: {
              kind: "thread",
              id: "thread-1",
              uri: "codex://threads/thread-1"
            },
            createdAt: "2026-08-11T12:00:00.000Z",
            updatedAt: "2026-08-11T12:00:20.000Z",
            activeUntil: "2026-08-11T12:01:20.000Z"
          }]
        }}
      />
    )

    expect(html).toContain("Current author: Willa King")
    expect(html).toContain("Codex agent: codex-1")
    expect(html).toContain(">W<")
    expect(html).toContain(">C<")
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2)
    expect(html.match(/data-base-ui-click-trigger/g)).toHaveLength(2)
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain("--crit-presence-collapsed-width:27px")
    expect(html).toContain("--crit-presence-expanded-width:47px")
    expect(critStyles).toContain(".crit-presence__positioner { height: var(--positioner-height)")
    expect(critStyles).toContain("z-index: 5000")
    expect(critStyles).toContain(".crit-presence__viewport {")
    expect(critStyles).toContain('data-activation-direction~="right"')
    expect(critStyles).toContain(
      '.crit-presence__card[data-starting-style], .crit-presence__card[data-ending-style]'
    )
    expect(critStyles).toContain(".crit-presence__glyph {")
    expect(critStyles).toContain("font-size: 14px")
    expect(critStyles).toContain("font-weight: 400")
    expect(critStyles).toContain(
      "transform: scale(var(--crit-presence-glyph-scale))"
    )
    expect(critStyles).toContain(
      ".crit-presence__name { color: var(--crit-color-t2"
    )
    expect(critStyles).toContain(
      ".crit-presence__secondary { color: var(--crit-color-t1"
    )
  })

  it("collapses presence overflow and preserves every avatar for expansion", () => {
    const html = renderToStaticMarkup(
      <CanvasPresenceIndicator
        presence={{
          currentAuthor: { id: "git:willa", name: "Willa King" },
          availability: "available",
          activities: ["Ava", "Jules", "Rin", "June"].map((harness, index) => ({
            schemaVersion: 1 as const,
            canvasId: "review",
            activityId: `agent-${index}`,
            harness,
            model: null,
            detail: null,
            reference: null,
            createdAt: "2026-08-11T12:00:00.000Z",
            updatedAt: "2026-08-11T12:00:20.000Z",
            activeUntil: "2026-08-11T12:01:20.000Z"
          }))
        }}
      />
    )

    expect(html).toContain('aria-label="Canvas presence: 5"')
    expect(html).toContain("--crit-presence-collapsed-width:52px")
    expect(html).toContain("--crit-presence-expanded-width:116px")
    expect(html).toContain(">+2<")
    expect(html.match(/class="crit-presence__item"/g)).toHaveLength(5)
    expect(html.match(/data-collapsed-hidden="true"/g)).toHaveLength(2)
    expect(html).toContain("--crit-presence-collapsed-x:11px")
    expect(html).toContain("--crit-presence-expanded-x:93px")
    expect(critStyles).toContain(
      ".crit-presence:hover, .crit-presence:focus-within"
    )
    expect(critStyles).toContain(
      "width: var(--crit-presence-expanded-width)"
    )
    expect(critStyles).toContain(
      ".crit-presence__item[data-collapsed-hidden] { opacity: 0; }"
    )
    expect(critStyles).toContain(
      ".crit-presence:hover .crit-presence__overflow"
    )
  })

  it("renders anonymous presence and a copy-ready Git identity remediation", () => {
    const presence = renderToStaticMarkup(
      <CanvasPresenceIndicator
        presence={{
          currentAuthor: { id: "git:willa", name: "Willa King" },
          availability: "unavailable",
          activities: []
        }}
      />
    )
    const guest = renderToStaticMarkup(
      <CanvasPresenceIndicator
        presence={{
          currentAuthor: null,
          availability: "available",
          activities: []
        }}
      />
    )
    const identity = renderToStaticMarkup(
      <GitIdentityBoundary
        detail="Git user.email is not configured"
        prompt={GIT_AUTHOR_REMEDIATION_PROMPT}
      />
    )

    expect(presence).toContain('aria-label="Anonymous agent presence"')
    expect(guest).toBe("")
    expect(identity).toContain("Git identity required")
    expect(identity).toContain("Copy fix prompt")
    expect(identity).toContain("crit-identity")
  })
})
