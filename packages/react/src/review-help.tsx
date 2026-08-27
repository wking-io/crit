import { Data } from "effect"
import {
  createContext,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode
} from "react"

import {
  reviewActionPolicies,
  type ReviewActionPolicy
} from "./review-actions.js"

export type ReviewHelpDetails = Data.TaggedEnum<{
  readonly action: {
    readonly name: string
    readonly description: string
    readonly shortcut: string | null
    readonly availabilityMessage: string | null
  }
  readonly informational: {
    readonly name: string
    readonly description: string
  }
}>
export const ReviewHelpDetails = Data.taggedEnum<ReviewHelpDetails>()

type ReviewHelpAttributes = {
  readonly "data-crit-help-kind": ReviewHelpDetails["_tag"]
  readonly "data-crit-help-name": string
  readonly "data-crit-help-description": string
  readonly "data-crit-help-shortcut": string | undefined
  readonly "data-crit-help-availability": string | undefined
}

const idleReviewHelp = ReviewHelpDetails.informational({
  name: "Review",
  description: "Hover or focus a control to see what it does."
})

const helpTarget = (details: ReviewHelpDetails): ReviewHelpAttributes => ({
  "data-crit-help-kind": details._tag,
  "data-crit-help-name": details.name,
  "data-crit-help-description": details.description,
  "data-crit-help-shortcut": ReviewHelpDetails.$is("action")(details)
    ? details.shortcut ?? undefined
    : undefined,
  "data-crit-help-availability": ReviewHelpDetails.$is("action")(details)
    ? details.availabilityMessage ?? undefined
    : undefined
})

export const reviewHelpForPolicy = (
  policy: ReviewActionPolicy
): Extract<ReviewHelpDetails, { readonly _tag: "action" }> =>
  ReviewHelpDetails.action({
    name: policy.label,
    description: policy.description,
    shortcut: policy.shortcuts[0] ?? null,
    availabilityMessage: null
  })

export const reviewActionHelpTarget = (
  policy: ReviewActionPolicy
): ReviewHelpAttributes => helpTarget(reviewHelpForPolicy(policy))

export const reviewInformationalHelpTarget = (
  input: {
    readonly name: string
    readonly description: string
  }
): ReviewHelpAttributes => helpTarget(ReviewHelpDetails.informational(input))

const detailsFromTarget = (
  target: EventTarget | null
): ReviewHelpDetails | null => {
  if (!(target instanceof Element)) return null
  const element = target.closest("[data-crit-help-name]")
  if (!(element instanceof HTMLElement)) return null
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
    ? ReviewHelpDetails.informational({
      name: critHelpName,
      description: critHelpDescription
    })
    : ReviewHelpDetails.action({
      name: critHelpName,
      description: critHelpDescription,
      shortcut: critHelpShortcut ?? null,
      availabilityMessage: critHelpAvailability ?? null
    })
}

const ReviewHelpContext = createContext<ReviewHelpDetails | null>(null)

export type ReviewHelpPointer = Data.TaggedEnum<{
  readonly away: {}
  readonly over: { readonly details: ReviewHelpDetails | null }
}>
export const ReviewHelpPointer = Data.taggedEnum<ReviewHelpPointer>()

const pointerAway = ReviewHelpPointer.away()

export const activeReviewHelpDetails = (
  pointer: ReviewHelpPointer,
  focusDetails: ReviewHelpDetails | null
): ReviewHelpDetails | null =>
  ReviewHelpPointer.$is("away")(pointer) ? focusDetails : pointer.details

export function ReviewHelpSurface({
  children,
  onBlur,
  onFocus,
  onPointerOut,
  onPointerOver,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly children: ReactNode }): ReactElement {
  const [pointer, setPointer] = useState<ReviewHelpPointer>(pointerAway)
  const [focusDetails, setFocusDetails] =
    useState<ReviewHelpDetails | null>(null)

  return (
    <ReviewHelpContext.Provider
      value={activeReviewHelpDetails(pointer, focusDetails)}
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
          setPointer(
            event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
              ? ReviewHelpPointer.over({
                details: detailsFromTarget(event.relatedTarget)
              })
              : pointerAway
          )
        }}
        onPointerOver={(event) => {
          onPointerOver?.(event)
          setPointer(ReviewHelpPointer.over({
            details: detailsFromTarget(event.target)
          }))
        }}
      >
        {children}
      </div>
    </ReviewHelpContext.Provider>
  )
}

const shortcutedPolicies = reviewActionPolicies.filter(
  (policy) => policy.shortcuts.length > 0
)

const ReviewHelpAction = ({
  details
}: {
  readonly details: Extract<ReviewHelpDetails, { readonly _tag: "action" }>
}): ReactElement => (
  <>
    <div className="crit-help__header">
      <div className="crit-help__title">{details.name}</div>
      {details.shortcut === null
        ? null
        : <div className="crit-help__shortcut">{details.shortcut}</div>}
    </div>
    <p className="crit-help__description">{details.description}</p>
    {details.availabilityMessage === null
      ? null
      : <p className="crit-help__availability">{details.availabilityMessage}</p>}
  </>
)

const IdleReviewHelp = (): ReactElement => (
  <>
    <div className="crit-help__header">
      <div className="crit-help__title">{idleReviewHelp.name}</div>
    </div>
    <p className="crit-help__description">{idleReviewHelp.description}</p>
    <ul className="crit-help__shortcuts">
      {shortcutedPolicies.map((policy) => {
        const shortcut = policy.shortcuts[0]
        return (
          <li key={policy.id}>
            {policy.label}
            {shortcut === undefined ? null : ` ${shortcut}`}
          </li>
        )
      })}
    </ul>
  </>
)

const reviewHelpBody = (
  details: ReviewHelpDetails | null
): ReactElement => {
  if (details === null) return <IdleReviewHelp />
  if (ReviewHelpDetails.$is("informational")(details)) {
    return (
      <>
        <div className="crit-help__header">
          <div className="crit-help__title">{details.name}</div>
        </div>
        <p className="crit-help__description">{details.description}</p>
      </>
    )
  }
  return <ReviewHelpAction details={details} />
}

export function ReviewHelpPanel(): ReactElement {
  const details = useContext(ReviewHelpContext)
  return (
    <aside aria-label="Control help" aria-live="polite" className="crit-help">
      {reviewHelpBody(details)}
    </aside>
  )
}
