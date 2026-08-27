export const TOOLBAR_OVERLAY_GAP = 8
export const TOOLBAR_OVERLAY_HOST = "[data-crit-toolbar]"

export const toolbarOverlayPositionerProps = {
  align: "start" as const,
  side: "bottom" as const,
  sideOffset: TOOLBAR_OVERLAY_GAP
}

export type ToolbarOverlayBounds = {
  readonly bottom: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly width: number
  readonly x: number
  readonly y: number
}

export const toolbarOverlayAnchorRect = (
  trigger: ToolbarOverlayBounds,
  toolbar: ToolbarOverlayBounds
) => ({
  bottom: toolbar.bottom,
  height: toolbar.height,
  left: trigger.left,
  right: trigger.right,
  top: toolbar.top,
  width: trigger.width,
  x: trigger.x,
  y: toolbar.y,
  toJSON: () => ({})
})

export const toolbarOverlayAnchor = (
  trigger: Element | null,
  toolbar: Element | null
) => {
  if (trigger === null) return null
  if (toolbar === null) return trigger
  return {
    contextElement: trigger,
    getBoundingClientRect: () => toolbarOverlayAnchorRect(
      trigger.getBoundingClientRect(),
      toolbar.getBoundingClientRect()
    )
  }
}

export const toolbarOverlayAnchorFor = (trigger: Element | null) =>
  toolbarOverlayAnchor(trigger, trigger?.closest(TOOLBAR_OVERLAY_HOST) ?? null)
