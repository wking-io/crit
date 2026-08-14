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
import { critStyles } from "../../src/react/crit-styles.js"
import { CanvasSelection } from "../../src/react/canvas-selection.js"
import { FRAME_STATUSES } from "../../src/react/frame-chrome.js"
import { CanvasToolbar } from "../../src/react/canvas-toolbar.js"
import { CanvasActionRunnerProvider } from "../../src/react/canvas-action-runner.js"
import { CanvasControls } from "../../src/react/canvas-controls.js"
import {
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
      storage: undefined,
      randomUUID: undefined,
      now: () => 123,
      random: () => 0.5
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
          commentAvailable
          noteAvailable
          onAction={() => {}}
          selectedItemCount={3}
          title="Feature lab"
          tool="select"
        />
      </CanvasActionRunnerProvider>
    )

    expect(html).toContain('role="toolbar"')
    expect(html).toContain("Feature lab")
    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('aria-label="Align and distribute"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain("Layers")
  })

  it("sizes the canvas toolbar from its title and controls", () => {
    const toolbar = cssRule(".crit-toolbar")
    const title = cssRule(".crit-toolbar__title")

    expect(toolbar).toContain("width: max-content")
    expect(toolbar).toContain("max-width: calc(100% - 40px)")
    expect(toolbar).not.toContain("width: 395px")
    expect(title).toContain("flex: 0 1 auto")
    expect(title).not.toContain("142px")
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

  it("keeps the original status fan geometry stable on screen across zoom", () => {
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const projection = statusFanProjection(zoom, 8)

      expect(projection.scale * zoom).toBeCloseTo(1)
      expect(projection.frameGap * zoom).toBeCloseTo(8)
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

  it("exposes an open comment pin as the reduced dot state", () => {
    const html = renderToStaticMarkup(
      <CanvasActionRunnerProvider><CanvasCommentPin
        active
        authorName="Wes"
        color="rebeccapurple"
        onOpen={() => Effect.void}
        threadId="thread-1"
        xRatio={0.5}
        yRatio={0.5}
      /></CanvasActionRunnerProvider>
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-active="true"')
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

  it("renders help without field labels and uses an inset-matched shortcut", () => {
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
    expect(cssRule(".crit-help__shortcut")).toContain(
      "border-radius: calc(var(--crit-help-radius) - var(--crit-help-inset))"
    )
    expect(cssRule(".crit-help")).toContain("gap: 0")
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

    const noteHandles = renderToStaticMarkup(
      <CanvasSelection
        handles={["west", "east"]}
        ink="#000"
        label="note"
        onResize={() => undefined}
        zoom={1}
      />
    )
    expect(noteHandles.match(/class="crit-selection__handle"/g)).toHaveLength(2)
    expect(noteHandles).toContain('data-resize-handle="west"')
    expect(noteHandles).toContain('data-resize-handle="east"')
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
      onBringToFront: () => Effect.void,
      onRemove: () => Effect.void,
      onSendToBack: () => Effect.void
    })

    expect(NOTE_MINIMUM_ROWS).toBe(3)
    expect(noteHeightForContent(84)).toBe(86)
    expect(items.map((item) => item.action.label)).toEqual([
      "Bring to front",
      "Send to back",
      "Remove note"
    ])
    const forbiddenItems = noteContextMenuItems({
      controls,
      target,
      currentAuthorIsTargetAuthor: false,
      onBringToFront: () => Effect.void,
      onRemove: () => Effect.void,
      onSendToBack: () => Effect.void
    })
    expect(forbiddenItems.at(-1)?.action.availability).toBe("hidden")
    expect(cssRule(".crit-note textarea")).toContain("overflow: hidden")
    expect(cssRule(".crit-note textarea")).toContain("min-height:")
    expect(cssRule(".crit-note textarea")).toContain(
      "font: 400 calc(14px * var(--crit-ui))/calc(20px * var(--crit-ui)) system-ui, -apple-system, sans-serif"
    )
    expect(cssRule(".crit-note::after")).toContain("box-shadow:")
    expect(critStyles).not.toContain(".crit-note__chrome")
  })

  it("renders Frames and attached Notes without a canvas framework", async () => {
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
    expect(html).toContain('rows="3"')
    expect(html).not.toContain("Attached to candidate")
    expect(html).toContain('data-crit-help-name="Frame status"')
    expect(html).not.toContain('data-crit-help-name="Edit frame title"')
    expect(html).not.toContain('class="crit-frame__title-edit-icon"')
    expect(html).toContain("crit-frame__title-label")
    expect(html).toContain('data-crit-help-name="Edit note"')
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
    expect(html).toContain('aria-label="Select" aria-pressed="true"')

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
    expect(unidentifiedHtml).toContain(
      'aria-label="Add note" class="crit-icon-button" disabled=""'
    )
    expect(html).toContain('aria-label="Hand" aria-pressed="false"')
    expect(html).toContain('aria-label="Add frame"')
    expect(html).toContain('aria-label="Add note"')
    expect(html.indexOf('class="crit-status-menu"')).toBeLessThan(
      html.indexOf('class="crit-frame__surface"')
    )
    expect(critStyles).toMatch(
      /\.crit-status-menu \{[^}]*z-index: 0;/s
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
    expect(html.match(/aria-label="Show all breakpoints"/g)).toHaveLength(1)
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

  it("renders letter avatars and hover details for unified Canvas Presence", () => {
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
    expect(html).toContain(">W<")
    expect(html).toContain(">C<")
    expect(html).toContain("GPT-5")
    expect(html).toContain('href="codex://threads/thread-1"')
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
    const identity = renderToStaticMarkup(
      <GitIdentityBoundary
        detail="Git user.email is not configured"
        prompt={GIT_AUTHOR_REMEDIATION_PROMPT}
      />
    )

    expect(presence).toContain("Anonymous agent")
    expect(identity).toContain("Git identity required")
    expect(identity).toContain("Copy fix prompt")
    expect(identity).toContain("crit-identity")
  })
})
