import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react"

type OverlayContainer = HTMLDivElement | null

const CritOverlayContainerContext = createContext<OverlayContainer | undefined>(
  undefined
)

const overlayClasses = (className: string | undefined) =>
  className === undefined
    ? "crit-overlay-container"
    : `crit-overlay-container ${className}`

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
