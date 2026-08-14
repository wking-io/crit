import { useHotkey } from "@tanstack/react-hotkeys"
import { Effect } from "effect"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react"
import { createPortal } from "react-dom"

import { defaultRuntimeCapabilities } from "../runtime/runtime-capabilities.js"

import {
  useCanvasActionRunner,
  useCanvasControls
} from "./canvas-action-runner.js"
import {
  tanStackHotkeysForAction,
  type ResolvedCanvasAction
} from "./canvas-controls.js"
import { actionHelpTarget } from "./canvas-help.js"
import { Glyph } from "./glyph.js"

export type ContextMenuPosition = {
  readonly x: number
  readonly y: number
}

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

export type ContextMenuItem =
  | ContextMenuActionItem
  | {
      readonly action: ResolvedCanvasAction
      readonly items: ReadonlyArray<ContextMenuActionItem>
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
  const controls = useCanvasControls(["canvas", "menu"], true)
  const runner = useCanvasActionRunner()
  const { action } = item
  if (action.availability === "hidden") return null
  const content = (
    <>
      <span>{action.label}</span>
      {item.detail === undefined ? null : (
        <span className="crit-context-menu__detail">{item.detail}</span>
      )}
    </>
  )

  return "href" in item ? (
    <a
      aria-keyshortcuts={action.ariaKeyShortcuts ?? undefined}
      href={item.href}
      {...actionHelpTarget(action)}
      onClick={onClose}
      onPointerEnter={onPointerEnter}
      rel="noreferrer"
      role="menuitem"
      target="_blank"
    >
      {content}
    </a>
  ) : (
    <button
      aria-keyshortcuts={action.ariaKeyShortcuts ?? undefined}
      data-tone={action.consequence === "destructive" ? "danger" : undefined}
      disabled={action.availability !== "enabled"}
      {...actionHelpTarget(action)}
      onClick={() => {
        onClose()
        runner.run(controls, action, item.execute, item.onFailure)
      }}
      onPointerEnter={onPointerEnter}
      role="menuitem"
      type="button"
    >
      {content}
    </button>
  )
}

export function CritContextMenu({
  ariaLabel,
  inline = false,
  items,
  onClose,
  position
}: {
  readonly ariaLabel: string
  readonly inline?: boolean
  readonly items: ReadonlyArray<ContextMenuItem>
  readonly onClose: () => void
  readonly position: ContextMenuPosition | null
}) {
  const controls = useCanvasControls(["canvas", "menu"], true)
  const runner = useCanvasActionRunner()
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<{
    readonly action: ResolvedCanvasAction
    readonly items: ReadonlyArray<ContextMenuActionItem>
    readonly position: ContextMenuPosition
  } | null>(null)

  const close = useCallback(() => {
    setSubmenu(null)
    onClose()
  }, [onClose])
  const closeAction = controls.action({ id: "close-context-menu" })
  const closeHotkey = tanStackHotkeysForAction(closeAction)[0]!

  useHotkey(closeHotkey, () => {
    runner.run(controls, closeAction, Effect.sync(close))
  }, {
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
      action: item.action,
      items: item.items,
      position: inline ? { x: 0, y: 0 } : {
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
    if (position !== null && !inline) {
      menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus()
    }
  }, [inline, position])

  const document = defaultRuntimeCapabilities.document()
  if (position === null || document === undefined) return null
  const visibleItems = items.filter((item) => item.action.availability !== "hidden")
  const menuWidth = 208
  const menuHeight = visibleItems.length * 34 + 8
  const left = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8))

  const content = (
    <>
      <div
        aria-label={ariaLabel}
        className="crit-context-menu"
        data-inline={inline || undefined}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={menuRef}
        role="menu"
        style={inline ? undefined : { left, top }}
      >
        {visibleItems.map((item) =>
          "items" in item ? (
            <button
              aria-expanded={submenu?.action.key === item.action.key}
              aria-haspopup="menu"
              aria-keyshortcuts={item.action.ariaKeyShortcuts ?? undefined}
              data-submenu-trigger=""
              disabled={item.action.availability !== "enabled"}
              {...actionHelpTarget(item.action)}
              key={item.action.key}
              onClick={(event) => {
                const trigger = event.currentTarget
                runner.run(
                  controls,
                  item.action,
                  Effect.sync(() => {
                    if (submenu?.action.key === item.action.key) setSubmenu(null)
                    else openSubmenu(item, trigger, true)
                  })
                )
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault()
                  openSubmenu(item, event.currentTarget, true)
                }
              }}
              onPointerEnter={(event) => {
                const trigger = event.currentTarget
                runner.run(
                  controls,
                  item.action,
                  Effect.sync(() => openSubmenu(item, trigger))
                )
              }}
              role="menuitem"
              type="button"
            >
              <span>{item.action.label}</span>
              <span aria-hidden="true" className="crit-context-menu__arrow"><Glyph name="chevronRight" /></span>
            </button>
          ) : (
            <ContextMenuAction
              item={item}
              key={`${item.action.key}:${item.action.label}`}
              onPointerEnter={() => setSubmenu(null)}
              onClose={close}
            />
          )
        )}
      </div>
      {submenu === null ? null : (
        <div
          aria-label={submenu.action.label}
          className="crit-context-menu crit-context-menu--submenu"
          data-inline={inline || undefined}
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
          style={inline ? undefined : { left: submenu.position.x, top: submenu.position.y }}
        >
          {submenu.items.map((item) => (
            <ContextMenuAction
              item={item}
              key={`${item.action.key}:${item.action.label}`}
              onClose={close}
            />
          ))}
        </div>
      )}
    </>
  )
  return inline
    ? <div className="crit-context-menu-cluster">{content}</div>
    : createPortal(content, document.body)
}
