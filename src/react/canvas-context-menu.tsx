import { Button } from "@base-ui/react/button"
import { ContextMenu } from "@base-ui/react/context-menu"
import { Menu } from "@base-ui/react/menu"
import { Effect } from "effect"
import {
  createContext,
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from "react"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import {
  type ResolvedCanvasAction
} from "./canvas-controls.js"
import { actionHelpTarget } from "./canvas-help.js"
import { cssVariableStyle } from "./css-variable-style.js"
import { Glyph } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"

export type ContextMenuActionItem =
  | {
      readonly action: ResolvedCanvasAction
      readonly detail?: ReactNode
      readonly execute: Effect.Effect<unknown, unknown>
      readonly onFailure?: (cause: unknown) => void
    }
  | {
      readonly action: ResolvedCanvasAction
      readonly detail?: ReactNode
      readonly href: string
    }

export interface ContextMenuSwatchOption {
  readonly label: string
  readonly color: string
  readonly selected: boolean
  readonly selectedShadowColor: string
  readonly execute: Effect.Effect<unknown, unknown>
  readonly onFailure?: (cause: unknown) => void
}

export type ContextMenuItem =
  | ContextMenuActionItem
  | {
      readonly action: ResolvedCanvasAction
      readonly items: ReadonlyArray<ContextMenuActionItem>
    }
  | {
      readonly action: ResolvedCanvasAction
      readonly swatches: ReadonlyArray<ContextMenuSwatchOption>
    }

type ActionMenuKind = "context-menu" | "menu"
const CONTEXT_MENU_KEY_SHORTCUTS = "Shift+F10 ContextMenu"
const CONTEXT_MENU_ITEM_HEIGHT = 28
const CONTEXT_MENU_VERTICAL_INSET = 8

export interface ContextMenuDismissalState {
  readonly revision: number
  readonly signal: number
}

interface ContextMenuOpenState {
  readonly open: boolean
  readonly revision: number
}

export const advanceContextMenuDismissal = (
  current: ContextMenuDismissalState,
  signal: number
): ContextMenuDismissalState => Object.is(current.signal, signal)
  ? current
  : { revision: current.revision + 1, signal }

export const contextMenuIsOpen = (
  state: ContextMenuOpenState,
  dismissalRevision: number
) => state.revision === dismissalRevision && state.open

const ContextMenuDismissalRevision = createContext(0)

export function CritContextMenuDismissalScope({
  children,
  signal
}: {
  readonly children: ReactNode
  readonly signal: number
}) {
  const dismissalRef = useRef<ContextMenuDismissalState>({
    revision: 0,
    signal
  })
  dismissalRef.current = advanceContextMenuDismissal(
    dismissalRef.current,
    signal
  )
  return (
    <ContextMenuDismissalRevision.Provider value={dismissalRef.current.revision}>
      {children}
    </ContextMenuDismissalRevision.Provider>
  )
}

function openContextMenuFromKeyboard(event: KeyboardEvent<HTMLElement>) {
  const isContextMenuShortcut = event.key === "ContextMenu" ||
    (event.key === "F10" && event.shiftKey)
  if (!isContextMenuShortcut || event.target !== event.currentTarget) return

  event.preventDefault()
  event.stopPropagation()
  const view = event.currentTarget.ownerDocument.defaultView
  if (view === null) return
  const bounds = event.currentTarget.getBoundingClientRect()
  event.currentTarget.dispatchEvent(new view.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
    view
  }))
}

function ActionItemContent({ item }: { readonly item: ContextMenuActionItem }) {
  return (
    <>
      <span>{item.action.label}</span>
      {item.detail === undefined ? null : (
        <span className="crit-context-menu__detail">{item.detail}</span>
      )}
    </>
  )
}

function BaseActionMenuItem({
  item,
  kind
}: {
  readonly item: ContextMenuActionItem
  readonly kind: ActionMenuKind
}) {
  const controls = useCanvasControls(["canvas", "menu"], true)
  const runner = useCanvasActionRunner()
  const { action } = item
  if (action.availability === "hidden") return null

  const sharedProps = {
    "aria-keyshortcuts": action.ariaKeyShortcuts ?? undefined,
    className: "crit-context-menu__item",
    "data-tone": action.consequence === "destructive" ? "danger" : undefined,
    label: action.label,
    ...actionHelpTarget(action)
  }
  if ("href" in item && action.availability === "enabled") {
    const link = (
      <a href={item.href} rel="noreferrer" target="_blank">
        <ActionItemContent item={item} />
      </a>
    )
    return kind === "context-menu" ? (
      <ContextMenu.LinkItem {...sharedProps} closeOnClick render={link} />
    ) : (
      <Menu.LinkItem {...sharedProps} closeOnClick render={link} />
    )
  }

  const itemProps = {
    ...sharedProps,
    disabled: action.availability !== "enabled",
    nativeButton: true,
    onClick: () => {
      if (!("execute" in item)) return
      runner.run(controls, action, item.execute, item.onFailure)
    },
    render: <Button type="button" />
  }
  return kind === "context-menu" ? (
    <ContextMenu.Item {...itemProps}>
      <ActionItemContent item={item} />
    </ContextMenu.Item>
  ) : (
    <Menu.Item {...itemProps}>
      <ActionItemContent item={item} />
    </Menu.Item>
  )
}

function BaseActionMenuItems({
  items,
  kind
}: {
  readonly items: ReadonlyArray<ContextMenuItem>
  readonly kind: ActionMenuKind
}) {
  const controls = useCanvasControls(["canvas", "menu"], true)
  const runner = useCanvasActionRunner()
  const overlayContainer = useCritOverlayContainer()
  return items.map((item) => {
    if (item.action.availability === "hidden") return null
    if ("swatches" in item) {
      const swatchProps = (option: ContextMenuSwatchOption) => ({
        "aria-label": `${option.label} note color${option.selected ? ", selected" : ""}`,
        className: "crit-context-menu__swatch",
        "data-selected": option.selected ? "" : undefined,
        disabled: item.action.availability !== "enabled",
        nativeButton: true,
        onClick: () => runner.run(
          controls,
          item.action,
          option.execute,
          option.onFailure
        ),
        render: <Button type="button" />,
        style: cssVariableStyle({
          "--crit-swatch": option.color,
          "--crit-swatch-selected-shadow": option.selectedShadowColor
        }),
        title: option.label
      })
      return (
        <div
          aria-label={item.action.label}
          className="crit-context-menu__swatches"
          key={`${item.action.key}:${item.action.label}`}
          role="group"
        >
          {item.swatches.map((option) => kind === "context-menu" ? (
            <ContextMenu.Item key={option.label} {...swatchProps(option)} />
          ) : (
            <Menu.Item key={option.label} {...swatchProps(option)} />
          ))}
        </div>
      )
    }
    if (!("items" in item)) {
      return (
        <BaseActionMenuItem
          item={item}
          key={`${item.action.key}:${item.action.label}`}
          kind={kind}
        />
      )
    }

    const triggerProps = {
      "aria-keyshortcuts": item.action.ariaKeyShortcuts ?? undefined,
      className: "crit-context-menu__item",
      disabled: item.action.availability !== "enabled",
      label: item.action.label,
      nativeButton: true,
      openOnHover: true,
      render: <Button type="button" />,
      ...actionHelpTarget(item.action)
    }
    const triggerContent = (
      <>
        <span>{item.action.label}</span>
        <span aria-hidden="true" className="crit-context-menu__arrow">
          <Glyph name="chevronRight" />
        </span>
      </>
    )
    const handleOpenChange = (open: boolean) => {
      if (!open || item.action.availability !== "enabled") return
      runner.run(controls, item.action, Effect.void)
    }
    return kind === "context-menu" ? (
      <ContextMenu.SubmenuRoot
        disabled={item.action.availability !== "enabled"}
        key={`${item.action.key}:${item.action.label}`}
        onOpenChange={handleOpenChange}
      >
        <ContextMenu.SubmenuTrigger {...triggerProps}>
          {triggerContent}
        </ContextMenu.SubmenuTrigger>
        <ContextMenu.Portal container={overlayContainer}>
          <ContextMenu.Positioner
            align="start"
            className="crit-context-menu__positioner crit-context-menu__positioner--submenu"
            side="right"
            sideOffset={4}
          >
            <ContextMenu.Popup
              aria-label={item.action.label}
              className="crit-context-menu crit-context-menu--submenu"
            >
              <BaseActionMenuItems items={item.items} kind={kind} />
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.SubmenuRoot>
    ) : (
      <Menu.SubmenuRoot
        disabled={item.action.availability !== "enabled"}
        key={`${item.action.key}:${item.action.label}`}
        onOpenChange={handleOpenChange}
      >
        <Menu.SubmenuTrigger {...triggerProps}>
          {triggerContent}
        </Menu.SubmenuTrigger>
        <Menu.Portal container={overlayContainer}>
          <Menu.Positioner
            align="start"
            className="crit-context-menu__positioner crit-context-menu__positioner--submenu"
            side="right"
            sideOffset={4}
          >
            <Menu.Popup
              aria-label={item.action.label}
              className="crit-context-menu crit-context-menu--submenu"
            >
              <BaseActionMenuItems items={item.items} kind={kind} />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.SubmenuRoot>
    )
  })
}

/**
 * Enhances an existing canvas surface with Base UI's context menu without
 * adding a DOM wrapper. The surface is focusable so Shift+F10 and the Menu key
 * provide the same actions without a persistent visual trigger.
 */
export function CritContextActions({
  ariaLabel,
  children,
  items,
  onOpenChange
}: {
  readonly ariaLabel: string
  readonly children: ReactElement
  readonly items: ReadonlyArray<ContextMenuItem>
  readonly onOpenChange?: (
    open: boolean,
    details: ContextMenu.Root.ChangeEventDetails
  ) => void
}) {
  const dismissalRevision = useContext(ContextMenuDismissalRevision)
  const overlayContainer = useCritOverlayContainer()
  const [openState, setOpenState] = useState<ContextMenuOpenState>({
    open: false,
    revision: dismissalRevision
  })
  return (
    // Nested Frame and Note triggers stop the originating context-menu and
    // long-press events, so an outer Canvas trigger only handles bare canvas.
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        onOpenChange?.(open, details)
        if (details.isCanceled) return
        setOpenState({ open, revision: dismissalRevision })
      }}
      open={contextMenuIsOpen(openState, dismissalRevision)}
    >
      <ContextMenu.Trigger
        aria-haspopup="menu"
        aria-keyshortcuts={CONTEXT_MENU_KEY_SHORTCUTS}
        aria-label={ariaLabel}
        onKeyDown={openContextMenuFromKeyboard}
        render={children}
        tabIndex={0}
      />
      <ContextMenu.Portal container={overlayContainer}>
        <ContextMenu.Positioner className="crit-context-menu__positioner">
          <ContextMenu.Popup aria-label={ariaLabel} className="crit-context-menu">
            <BaseActionMenuItems items={items} kind="context-menu" />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/** An always-visible Base UI menu used by the repository's component gallery. */
export function CritMenuSpecimen({
  ariaLabel,
  items
}: {
  readonly ariaLabel: string
  readonly items: ReadonlyArray<ContextMenuItem>
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const overlayContainer = useCritOverlayContainer()
  const visibleItemCount = items.filter(
    (item) => item.action.availability !== "hidden"
  ).length
  return (
    <div
      className="crit-context-menu-cluster"
      data-crit-menu-specimen=""
      style={{
        minHeight: visibleItemCount * CONTEXT_MENU_ITEM_HEIGHT +
          CONTEXT_MENU_VERTICAL_INSET
      }}
    >
      <div
        aria-hidden="true"
        className="crit-context-menu-specimen__anchor"
        ref={anchorRef}
      />
      <Menu.Root modal={false} open>
        <Menu.Portal container={overlayContainer} keepMounted>
          <Menu.Positioner
            align="start"
            anchor={anchorRef}
            className="crit-context-menu__positioner"
            collisionAvoidance={{
              align: "none",
              fallbackAxisSide: "none",
              side: "none"
            }}
            side="bottom"
          >
            <Menu.Popup
              aria-label={ariaLabel}
              className="crit-context-menu"
              finalFocus={false}
            >
              <BaseActionMenuItems items={items} kind="menu" />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
