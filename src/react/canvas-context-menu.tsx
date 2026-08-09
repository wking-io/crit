import { useHotkey } from "@tanstack/react-hotkeys"
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

import { NO_HELP_HOTKEY, helpTarget } from "./canvas-help.js"

export type ContextMenuPosition = {
  readonly x: number
  readonly y: number
}

export type ContextMenuActionItem =
  | {
      readonly detail?: string
      readonly help: string
      readonly label: string
      readonly onSelect: () => void
      readonly tone?: "danger"
    }
  | {
      readonly detail?: string
      readonly help: string
      readonly href: string
      readonly label: string
    }

export type ContextMenuItem =
  | ContextMenuActionItem
  | {
      readonly help: string
      readonly items: ReadonlyArray<ContextMenuActionItem>
      readonly label: string
    }

function ContextMenuAction({
  item,
  onClose,
  onPointerEnter
}: {
  readonly item: ContextMenuActionItem
  readonly onClose: () => void
  readonly onPointerEnter?: () => void
}) {
  const content = (
    <>
      <span>{item.label}</span>
      {item.detail === undefined ? null : (
        <span className="crit-context-menu__detail">{item.detail}</span>
      )}
    </>
  )

  return "href" in item ? (
    <a
      href={item.href}
      {...helpTarget({
        name: item.label,
        hotkey: NO_HELP_HOTKEY,
        description: item.help
      })}
      onClick={onClose}
      {...(onPointerEnter === undefined ? {} : { onPointerEnter })}
      rel="noreferrer"
      role="menuitem"
      target="_blank"
    >
      {content}
    </a>
  ) : (
    <button
      data-tone={item.tone}
      {...helpTarget({
        name: item.label,
        hotkey: NO_HELP_HOTKEY,
        description: item.help
      })}
      onClick={() => {
        onClose()
        item.onSelect()
      }}
      {...(onPointerEnter === undefined ? {} : { onPointerEnter })}
      role="menuitem"
      type="button"
    >
      {content}
    </button>
  )
}

export function CritContextMenu({
  ariaLabel,
  items,
  onClose,
  position
}: {
  readonly ariaLabel: string
  readonly items: ReadonlyArray<ContextMenuItem>
  readonly onClose: () => void
  readonly position: ContextMenuPosition | null
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<{
    readonly items: ReadonlyArray<ContextMenuActionItem>
    readonly label: string
    readonly position: ContextMenuPosition
  } | null>(null)

  const close = useCallback(() => {
    setSubmenu(null)
    onClose()
  }, [onClose])

  useHotkey("Escape", close, {
    conflictBehavior: "allow",
    enabled: position !== null,
    ignoreInputs: false
  })

  const openSubmenu = (
    item: Extract<ContextMenuItem, { readonly items: unknown }>,
    trigger: HTMLButtonElement,
    focusFirst = false
  ) => {
    const rect = trigger.getBoundingClientRect()
    const menuWidth = 208
    const submenuHeight = item.items.length * 34 + 8
    const opensRight = rect.right + 4 + menuWidth <= window.innerWidth - 8
    setSubmenu({
      items: item.items,
      label: item.label,
      position: {
        x: opensRight ? rect.right + 4 : rect.left - menuWidth - 4,
        y: Math.max(8, Math.min(rect.top, window.innerHeight - submenuHeight - 8))
      }
    })
    if (focusFirst) {
      window.requestAnimationFrame(() => {
        submenuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
      })
    }
  }

  useEffect(() => {
    if (position === null) return
    const closeFromOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (menuRef.current?.contains(event.target) === true ||
          submenuRef.current?.contains(event.target) === true)
      ) return
      close()
    }
    window.addEventListener("pointerdown", closeFromOutside, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [close, position])

  useEffect(() => {
    if (position !== null) {
      menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
    }
  }, [position])

  if (position === null || typeof document === "undefined") return null
  const menuWidth = 208
  const menuHeight = items.length * 34 + 8
  const left = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8))

  return createPortal(
    <>
      <div
        aria-label={ariaLabel}
        className="crit-context-menu"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={menuRef}
        role="menu"
        style={{ left, top }}
      >
        {items.map((item) =>
          "items" in item ? (
            <button
              aria-expanded={submenu?.label === item.label}
              aria-haspopup="menu"
              data-submenu-trigger=""
              {...helpTarget({
                name: item.label,
                hotkey: NO_HELP_HOTKEY,
                description: item.help
              })}
              key={item.label}
              onClick={(event) => {
                if (submenu?.label === item.label) setSubmenu(null)
                else openSubmenu(item, event.currentTarget, true)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault()
                  openSubmenu(item, event.currentTarget, true)
                }
              }}
              onPointerEnter={(event) => openSubmenu(item, event.currentTarget)}
              role="menuitem"
              type="button"
            >
              <span>{item.label}</span>
              <span aria-hidden="true" className="crit-context-menu__arrow">›</span>
            </button>
          ) : (
            <ContextMenuAction
              item={item}
              key={item.label}
              onPointerEnter={() => setSubmenu(null)}
              onClose={close}
            />
          )
        )}
      </div>
      {submenu === null ? null : (
        <div
          aria-label={submenu.label}
          className="crit-context-menu crit-context-menu--submenu"
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              menuRef.current
                ?.querySelector<HTMLElement>("[data-submenu-trigger]")
                ?.focus()
              setSubmenu(null)
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
          ref={submenuRef}
          role="menu"
          style={{ left: submenu.position.x, top: submenu.position.y }}
        >
          {submenu.items.map((item) => (
            <ContextMenuAction
              item={item}
              key={item.label}
              onClose={close}
            />
          ))}
        </div>
      )}
    </>,
    document.body
  )
}
