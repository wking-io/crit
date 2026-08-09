import { AnimatePresence, motion } from "motion/react"
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

export const CANVAS_HELP_MOTION = {
  closed: { opacity: 0, scale: 0.96, y: 4 },
  open: { opacity: 1, scale: 1, y: 0 },
  transition: {
    opacity: { duration: 0.12, ease: [0.25, 0.1, 0.25, 1] },
    scale: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
    y: { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
  }
} as const

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

export function CanvasHelpPanel() {
  const details = useContext(CanvasHelpContext)
  return (
    <AnimatePresence>
      {details === null ? null : (
        <motion.aside
          animate={CANVAS_HELP_MOTION.open}
          aria-label="Control help"
          aria-live="polite"
          className="crit-help"
          exit={CANVAS_HELP_MOTION.closed}
          initial={CANVAS_HELP_MOTION.closed}
          key="canvas-help"
          transition={CANVAS_HELP_MOTION.transition}
        >
          <div className="crit-help__header">
            <div className="crit-help__field">
              <span className="crit-help__label">Name</span>
              <strong>{details.name}</strong>
            </div>
            <div className="crit-help__field crit-help__field--hotkey">
              <span className="crit-help__label">Hotkey</span>
              <kbd>{details.hotkey}</kbd>
            </div>
          </div>
          <div className="crit-help__field crit-help__description">
            <span className="crit-help__label">Description</span>
            <p>{details.description}</p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
