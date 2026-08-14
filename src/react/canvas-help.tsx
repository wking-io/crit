import { Schema } from "effect"
import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode
} from "react"

import type { ResolvedCanvasAction } from "./canvas-controls.js"

export const ResolvedActionHelp = Schema.TaggedStruct("action", {
  name: Schema.String,
  description: Schema.String,
  shortcut: Schema.NullOr(Schema.String),
  availabilityMessage: Schema.NullOr(Schema.String)
}).pipe(Schema.brand("ResolvedActionHelp"))
export type ResolvedActionHelp = typeof ResolvedActionHelp.Type

export const InformationalHelp = Schema.TaggedStruct("informational", {
  name: Schema.String,
  description: Schema.String
})
export type InformationalHelp = typeof InformationalHelp.Type

export const CanvasHelpDetails = Schema.Union([
  ResolvedActionHelp,
  InformationalHelp
])
export type CanvasHelpDetails = typeof CanvasHelpDetails.Type

type InformationalHelpInput = Omit<InformationalHelp, "_tag">

type CanvasHelpAttributes = {
  readonly "data-crit-help-kind": CanvasHelpDetails["_tag"]
  readonly "data-crit-help-name": string
  readonly "data-crit-help-description": string
  readonly "data-crit-help-shortcut": string | undefined
  readonly "data-crit-help-availability": string | undefined
}

const helpTarget = (input: CanvasHelpDetails): CanvasHelpAttributes => {
  const details = Schema.decodeUnknownSync(CanvasHelpDetails)(input)
  return {
    "data-crit-help-kind": details._tag,
    "data-crit-help-name": details.name,
    "data-crit-help-description": details.description,
    "data-crit-help-shortcut": details._tag === "action"
      ? details.shortcut ?? undefined
      : undefined,
    "data-crit-help-availability": details._tag === "action"
      ? details.availabilityMessage ?? undefined
      : undefined
  }
}

export const actionHelpDetails = (
  action: ResolvedCanvasAction
): ResolvedActionHelp => Schema.decodeUnknownSync(ResolvedActionHelp)({
  _tag: "action",
  name: action.label,
  description: action.description,
  shortcut: action.shortcut,
  availabilityMessage: action.availability === "enabled"
    ? null
    : action.availabilityMessage
})

export const actionHelpTarget = (
  action: ResolvedCanvasAction
): CanvasHelpAttributes => helpTarget(actionHelpDetails(action))

export const informationalHelpTarget = (
  input: InformationalHelpInput
): CanvasHelpAttributes => helpTarget({ _tag: "informational", ...input })

const detailsFromTarget = (
  target: EventTarget | null
): CanvasHelpDetails | null => {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>("[data-crit-help-name]")
  if (element === null) return null
  const {
    critHelpKind,
    critHelpName,
    critHelpDescription,
    critHelpShortcut,
    critHelpAvailability
  } = element.dataset
  if (
    critHelpName === undefined ||
    critHelpDescription === undefined ||
    (critHelpKind !== "action" && critHelpKind !== "informational")
  ) return null
  return critHelpKind === "informational"
    ? {
        _tag: "informational",
        name: critHelpName,
        description: critHelpDescription
      }
    : Schema.decodeUnknownSync(ResolvedActionHelp)({
        _tag: "action",
        name: critHelpName,
        description: critHelpDescription,
        shortcut: critHelpShortcut ?? null,
        availabilityMessage: critHelpAvailability ?? null
      })
}

const CanvasHelpContext = createContext<CanvasHelpDetails | null>(null)

export const activeCanvasHelpDetails = (
  pointerDetails: CanvasHelpDetails | null | undefined,
  focusDetails: CanvasHelpDetails | null
): CanvasHelpDetails | null => pointerDetails === undefined
  ? focusDetails
  : pointerDetails

export function CanvasHelpSurface({
  children,
  onBlur,
  onFocus,
  onPointerOut,
  onPointerOver,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly children: ReactNode }) {
  const [pointerDetails, setPointerDetails] =
    useState<CanvasHelpDetails | null | undefined>()
  const [focusDetails, setFocusDetails] =
    useState<CanvasHelpDetails | null>(null)

  return (
    <CanvasHelpContext.Provider
      value={activeCanvasHelpDetails(pointerDetails, focusDetails)}
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
          setPointerDetails(
            event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
              ? detailsFromTarget(event.relatedTarget)
              : undefined
          )
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
        {details._tag === "action" && details.shortcut !== null ? (
          <div className="crit-help__shortcut">{details.shortcut}</div>
        ) : null}
      </div>
      <p className="crit-help__description">{details.description}</p>
      {details._tag === "action" && details.availabilityMessage !== null ? (
        <p className="crit-help__availability">{details.availabilityMessage}</p>
      ) : null}
    </aside>
  )
}
