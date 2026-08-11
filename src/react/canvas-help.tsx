import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode
} from "react"

export interface CanvasHelpDetails {
  readonly name: string
  readonly hotkey: string
  readonly description: string
}

export const NO_HELP_HOTKEY = "—"

type CanvasHelpAttributes = {
  readonly "data-crit-help-name": string
  readonly "data-crit-help-hotkey": string
  readonly "data-crit-help-description": string
}

export const helpTarget = (
  details: CanvasHelpDetails
): CanvasHelpAttributes => ({
  "data-crit-help-name": details.name,
  "data-crit-help-hotkey": details.hotkey,
  "data-crit-help-description": details.description
})

const detailsFromTarget = (
  target: EventTarget | null
): CanvasHelpDetails | undefined => {
  if (!(target instanceof Element)) return undefined
  const element = target.closest<HTMLElement>("[data-crit-help-name]")
  if (element === null) return undefined
  const { critHelpName, critHelpHotkey, critHelpDescription } = element.dataset
  return critHelpName === undefined ||
    critHelpHotkey === undefined ||
    critHelpDescription === undefined
    ? undefined
    : {
        name: critHelpName,
        hotkey: critHelpHotkey,
        description: critHelpDescription
      }
}

const CanvasHelpContext = createContext<CanvasHelpDetails | null>(null)

export function CanvasHelpSurface({
  children,
  onBlur,
  onFocus,
  onPointerOut,
  onPointerOver,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly children: ReactNode }) {
  const [pointerDetails, setPointerDetails] =
    useState<CanvasHelpDetails | undefined>()
  const [focusDetails, setFocusDetails] =
    useState<CanvasHelpDetails | undefined>()

  return (
    <CanvasHelpContext.Provider
      value={pointerDetails ?? focusDetails ?? null}
    >
      <div
        {...props}
        onBlur={(event) => {
          onBlur?.(event)
          setFocusDetails(detailsFromTarget(event.relatedTarget))
        }}
        onFocus={(event) => {
          onFocus?.(event)
          setFocusDetails(detailsFromTarget(event.target))
        }}
        onPointerOut={(event) => {
          onPointerOut?.(event)
          setPointerDetails(detailsFromTarget(event.relatedTarget))
        }}
        onPointerOver={(event) => {
          onPointerOver?.(event)
          setPointerDetails(detailsFromTarget(event.target))
        }}
      >
        {children}
      </div>
    </CanvasHelpContext.Provider>
  )
}

export function CanvasHelpPanel({
  details: suppliedDetails
}: {
  readonly details?: CanvasHelpDetails
} = {}) {
  const contextDetails = useContext(CanvasHelpContext)
  const details = suppliedDetails ?? contextDetails
  if (details === null) return null
  return (
    <aside aria-label="Control help" aria-live="polite" className="crit-help">
      <div className="crit-help__header">
        <div className="crit-help__title">{details.name}</div>
        {details.hotkey === NO_HELP_HOTKEY ? null : (
          <div className="crit-help__shortcut">{details.hotkey}</div>
        )}
      </div>
      <p className="crit-help__description">{details.description}</p>
    </aside>
  )
}
