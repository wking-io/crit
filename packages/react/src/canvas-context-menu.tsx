import { Button } from "@base-ui/react/button"
import { ContextMenu } from "@base-ui/react/context-menu"
import { Menu } from "@base-ui/react/menu"
import { Data, Match } from "effect"
import {
  createContext,
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from "react"

import { Glyph } from "./glyph.js"
import { useCritOverlayContainer } from "./overlay-container.js"
import {
  reviewActionHelpTarget,
  reviewInformationalHelpTarget
} from "./review-help.js"
import type { ReviewActionPolicy } from "./review-actions.js"

export type ReviewMenuItem = Data.TaggedEnum<{
  readonly action: {
    readonly policy: ReviewActionPolicy
    readonly disabled?: boolean
    readonly onSelect: () => void
  }
  readonly link: {
    readonly policy: ReviewActionPolicy
    readonly href: string
  }
  readonly submenu: {
    readonly id: string
    readonly label: string
    readonly description: string
    readonly items: readonly ReviewMenuItem[]
  }
}>
export const ReviewMenuItem = Data.taggedEnum<ReviewMenuItem>()

export const reviewMenuItemIsVisible = (_item: ReviewMenuItem) => true

const CONTEXT_MENU_KEY_SHORTCUTS = "Shift+F10 ContextMenu"
const CONTEXT_MENU_ITEM_HEIGHT = 28
const CONTEXT_MENU_VERTICAL_INSET = 8

interface ContextMenuOpenState {
  readonly open: boolean
  readonly revision: number
}

export const contextMenuIsOpen = (
  state: ContextMenuOpenState,
  dismissalRevision: number
) => state.revision === dismissalRevision && state.open

const ContextMenuDismissalRevision = createContext(0)

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

function ActionItemContent({
  label
}: {
  readonly label: string
}) {
  return <span>{label}</span>
}

function ReviewMenuEntry({
  item,
  kind
}: {
  readonly item: ReviewMenuItem
  readonly kind: "context-menu" | "menu"
}) {
  const overlayContainer = useCritOverlayContainer()
  return Match.value(item).pipe(Match.tagsExhaustive({
    action: (entry) => {
      const sharedProps = {
        "aria-keyshortcuts": entry.policy.shortcuts[0],
        "aria-label": entry.policy.label,
        className: "crit-context-menu__item",
        "data-tone": entry.policy.id === "remove" ? "danger" : undefined,
        disabled: entry.disabled === true,
        label: entry.policy.label,
        nativeButton: true,
        onClick: entry.onSelect,
        render: <Button type="button" />,
        ...reviewActionHelpTarget(entry.policy)
      }
      return kind === "context-menu"
        ? (
          <ContextMenu.Item {...sharedProps}>
            <ActionItemContent label={entry.policy.label} />
          </ContextMenu.Item>
        )
        : (
          <Menu.Item {...sharedProps}>
            <ActionItemContent label={entry.policy.label} />
          </Menu.Item>
        )
    },
    link: (entry) => {
      const link = (
        <a href={entry.href} rel="noreferrer" target="_blank">
          <ActionItemContent label={entry.policy.label} />
        </a>
      )
      const sharedProps = {
        "aria-keyshortcuts": entry.policy.shortcuts[0],
        "aria-label": entry.policy.label,
        className: "crit-context-menu__item",
        closeOnClick: true,
        label: entry.policy.label,
        render: link,
        ...reviewActionHelpTarget(entry.policy)
      }
      return kind === "context-menu"
        ? <ContextMenu.LinkItem {...sharedProps} />
        : <Menu.LinkItem {...sharedProps} />
    },
    submenu: (entry) => {
      const triggerProps = {
        "aria-label": entry.label,
        className: "crit-context-menu__item",
        label: entry.label,
        nativeButton: true,
        openOnHover: true,
        render: <Button type="button" />,
        ...reviewInformationalHelpTarget({
          name: entry.label,
          description: entry.description
        })
      }
      const triggerContent = (
        <>
          <span>{entry.label}</span>
          <span aria-hidden="true" className="crit-context-menu__arrow">
            <Glyph name="chevronRight" />
          </span>
        </>
      )
      const items = (
        <ReviewMenuEntries items={entry.items} kind={kind} />
      )
      return kind === "context-menu"
        ? (
          <ContextMenu.SubmenuRoot>
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
                  aria-label={entry.label}
                  className="crit-context-menu crit-context-menu--submenu"
                >
                  {items}
                </ContextMenu.Popup>
              </ContextMenu.Positioner>
            </ContextMenu.Portal>
          </ContextMenu.SubmenuRoot>
        )
        : (
          <Menu.SubmenuRoot>
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
                  aria-label={entry.label}
                  className="crit-context-menu crit-context-menu--submenu"
                >
                  {items}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.SubmenuRoot>
        )
    }
  }))
}

function ReviewMenuEntries({
  items,
  kind
}: {
  readonly items: readonly ReviewMenuItem[]
  readonly kind: "context-menu" | "menu"
}) {
  return items.map((item) => (
    <ReviewMenuEntry
      item={item}
      key={Match.value(item).pipe(Match.tagsExhaustive({
        action: ({ policy }) => policy.id,
        link: ({ policy }) => policy.id,
        submenu: ({ id }) => id
      }))}
      kind={kind}
    />
  ))
}

export function CritContextActions({
  ariaLabel,
  children,
  items,
  onOpenChange
}: {
  readonly ariaLabel: string
  readonly children: ReactElement
  readonly items: readonly ReviewMenuItem[]
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
            <ReviewMenuEntries items={items} kind="context-menu" />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

export function CritMenuSpecimen({
  ariaLabel,
  items
}: {
  readonly ariaLabel: string
  readonly items: readonly ReviewMenuItem[]
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const overlayContainer = useCritOverlayContainer()
  const visibleItemCount = items.filter(reviewMenuItemIsVisible).length
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
              <ReviewMenuEntries items={items} kind="menu" />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
