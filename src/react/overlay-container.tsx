import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react"

type OverlayContainer = HTMLDivElement | null
type UnderlayContainer = HTMLDivElement | null

const CritOverlayContainerContext = createContext<OverlayContainer | undefined>(
  undefined
)
const CritUnderlayContainerContext = createContext<UnderlayContainer | undefined>(
  undefined
)

const overlayClasses = (className: string | undefined) =>
  className === undefined
    ? "crit-overlay-container"
    : `crit-overlay-container ${className}`

const underlayClasses = (className: string | undefined) =>
  className === undefined
    ? "crit-underlay-container"
    : `crit-underlay-container ${className}`

/**
 * Provides a screen-coordinate portal layer above the Canvas background but
 * below its transformed plane. It is the semantic home for UI that should
 * emerge from behind Canvas items without inheriting the plane transform.
 */
export function CritUnderlayProvider({
  children,
  className
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  return (
    <CritUnderlayContainerContext.Provider value={container}>
      <div
        className={underlayClasses(className)}
        data-crit-underlay-container=""
        ref={setContainer}
      />
      {children}
    </CritUnderlayContainerContext.Provider>
  )
}

/**
 * Keeps Base UI portals inside the nearest themed Crit surface. Consumers that
 * render outside a provider continue to use Base UI's default document body.
 */
export function CritOverlayProvider({
  children,
  className
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  return (
    <CritOverlayContainerContext.Provider value={container}>
      {children}
      <div
        className={overlayClasses(className)}
        data-crit-overlay-container=""
        ref={setContainer}
      />
    </CritOverlayContainerContext.Provider>
  )
}

export const useCritOverlayContainer = () =>
  useContext(CritOverlayContainerContext)

export const useCritUnderlayContainer = () =>
  useContext(CritUnderlayContainerContext)
