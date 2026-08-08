import { useState } from "react"
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  stopEventPropagation,
  toDomPrecision,
  useEditor,
  useValue,
  type TLDragShapesOutInfo,
  type TLDragShapesOverInfo,
  type TLResizeInfo,
  type TLShape,
  type TLShapePartial
} from "tldraw"

import {
  critFrameMigrations,
  critFrameProps
} from "../core/internal/tldraw-schema.js"
import type { CritFrame } from "../core/index.js"

export const isFrameInteractiveTool = (toolId: string) => toolId === "select"

const statusLabels = {
  "in-progress": "In progress",
  approved: "Approved",
  "changes-requested": "Changes requested"
} as const

const statusColors = {
  "in-progress": "#2563eb",
  approved: "#16803a",
  "changes-requested": "#c2410c"
} as const

const frameRootStyle = {
  position: "relative",
  overflow: "visible",
  borderRadius: 8,
  background: "#ffffff",
  border: "1px solid rgba(15, 23, 42, 0.22)",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)"
} as const

function CritFrameView({ shape }: { readonly shape: CritFrame }) {
  const editor = useEditor()
  const [loadFailed, setLoadFailed] = useState(false)
  const iframeIsInteractive = useValue(
    "Crit frame iframe interaction",
    () => isFrameInteractiveTool(editor.getCurrentToolId()),
    [editor]
  )
  const statusColor = statusColors[shape.props.status]

  return (
    <HTMLContainer
      style={{
        ...frameRootStyle,
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all"
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#f8fafc",
          borderBottom: "1px solid rgba(15, 23, 42, 0.12)",
          borderRadius: "8px 8px 0 0",
          boxSizing: "border-box",
          color: "#0f172a",
          display: "flex",
          font: "500 12px/1.2 ui-sans-serif, system-ui, sans-serif",
          gap: 8,
          height: 32,
          padding: "0 10px"
        }}
      >
        <span
          aria-hidden="true"
          style={{
            background: statusColor,
            borderRadius: 999,
            flex: "0 0 auto",
            height: 8,
            width: 8
          }}
        />
        <strong
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={shape.props.title}
        >
          {shape.props.title}
        </strong>
        <span style={{ color: statusColor, flex: "0 0 auto" }}>
          {statusLabels[shape.props.status]}
        </span>
        <a
          aria-label={`Open ${shape.props.title} in a new tab`}
          href={shape.props.url}
          onPointerDown={stopEventPropagation}
          rel="noreferrer"
          style={{ color: "#475569", pointerEvents: "all", textDecoration: "none" }}
          target="_blank"
        >
          ↗
        </a>
      </div>
      <div
        style={{
          background: "#ffffff",
          borderRadius: "0 0 8px 8px",
          height: "calc(100% - 32px)",
          overflow: "hidden",
          position: "relative"
        }}
      >
        {loadFailed ? (
          <div
            role="alert"
            style={{
              alignItems: "center",
              boxSizing: "border-box",
              color: "#475569",
              display: "flex",
              flexDirection: "column",
              font: "500 13px/1.5 ui-sans-serif, system-ui, sans-serif",
              height: "100%",
              justifyContent: "center",
              padding: 24,
              textAlign: "center"
            }}
          >
            <strong style={{ color: "#0f172a" }}>Could not load this frame.</strong>
            <span>The page may be offline or may block iframe access.</span>
          </div>
        ) : null}
        <iframe
          allow="clipboard-read; clipboard-write; fullscreen"
          onError={() => setLoadFailed(true)}
          referrerPolicy="no-referrer"
          src={shape.props.url}
          tabIndex={iframeIsInteractive ? 0 : -1}
          title={shape.props.title}
          style={{
            border: 0,
            display: loadFailed ? "none" : "block",
            height: "100%",
            pointerEvents: iframeIsInteractive ? "auto" : "none",
            width: "100%"
          }}
        />
      </div>
    </HTMLContainer>
  )
}

export class CritFrameShapeUtil extends BaseBoxShapeUtil<CritFrame> {
  static override type = "crit-frame" as const
  static override props = critFrameProps
  static override migrations = critFrameMigrations

  override canResize() {
    return true
  }

  override canResizeChildren() {
    return false
  }

  providesBackgroundForChildren() {
    return true
  }

  override canReceiveNewChildrenOfType(shape: CritFrame, type: TLShape["type"]) {
    return !shape.isLocked && type !== CritFrameShapeUtil.type
  }

  override getDefaultProps(): CritFrame["props"] {
    return {
      w: 960,
      h: 640,
      url: "about:blank",
      title: "Untitled frame",
      status: "in-progress",
      provenance: { kind: "manual", sourceId: "local" },
      display: { heightMode: "viewport" }
    }
  }

  override getAriaDescriptor(shape: CritFrame) {
    return `${shape.props.title}, ${statusLabels[shape.props.status]}`
  }

  override getGeometry(shape: CritFrame) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    })
  }

  override component(shape: CritFrame) {
    return <CritFrameView shape={shape} />
  }

  override indicator(shape: CritFrame) {
    return (
      <rect
        height={toDomPrecision(shape.props.h)}
        rx={8}
        ry={8}
        width={toDomPrecision(shape.props.w)}
      />
    )
  }

  override onResize(shape: CritFrame, info: TLResizeInfo<CritFrame>) {
    return resizeBox(shape, info)
  }

  override onDragShapesIn(
    shape: CritFrame,
    draggingShapes: TLShape[],
    { initialParentIds, initialIndices }: TLDragShapesOverInfo
  ) {
    if (draggingShapes.every((child) => child.parentId === shape.id)) return
    if (draggingShapes.some((child) => this.editor.hasAncestor(shape, child.id))) {
      return
    }

    const previousChildren = draggingShapes.filter(
      (child) => initialParentIds.get(child.id) === shape.id
    )
    const currentChildren = this.editor
      .getSortedChildIdsForParent(shape)
      .map((id) => this.editor.getShape(id))
      .filter((child): child is TLShape => child !== undefined)
    const canRestoreOriginalIndices =
      previousChildren.length > 0 &&
      previousChildren.every(
        (child) => !currentChildren.some((current) => current.index === child.index)
      )

    this.editor.reparentShapes(draggingShapes, shape.id)
    if (!canRestoreOriginalIndices) return

    const updates: TLShapePartial[] = previousChildren.map((child) => ({
      id: child.id,
      type: child.type,
      index: initialIndices.get(child.id)!
    }))
    this.editor.updateShapes(updates)
  }

  override onDragShapesOut(
    shape: CritFrame,
    draggingShapes: TLShape[],
    info: TLDragShapesOutInfo
  ) {
    if (info.nextDraggingOverShapeId) return
    this.editor.reparentShapes(
      draggingShapes.filter(
        (child) => child.parentId === shape.id && !child.isLocked
      ),
      this.editor.getCurrentPageId()
    )
  }
}
