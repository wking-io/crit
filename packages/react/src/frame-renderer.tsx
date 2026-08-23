import {
  RepresentationRef as RepresentationRefSchema,
  type Frame,
  type RepresentationRef
} from "@crit/domain"
import type { RenderPlan } from "@crit/representations"
import { Effect, Fiber, Match, Schema } from "effect"
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactElement
} from "react"

export type FrameRendererFrame = Pick<
  Frame,
  "title" | "representation" | "representationChangedByChangeId"
>

export interface FrameRepresentationResolver {
  readonly resolve: (
    representation: RepresentationRef
  ) => Effect.Effect<RenderPlan, unknown>
}

export interface FrameRendererProps {
  readonly frame: FrameRendererFrame
  readonly resolver: FrameRepresentationResolver
  readonly className?: string
}

type RenderState =
  | {
    readonly _tag: "resolving"
    readonly representation: RepresentationRef
    readonly revision: Frame["representationChangedByChangeId"]
    readonly generation: number
    readonly resolver: FrameRepresentationResolver
  }
  | {
    readonly _tag: "resolved"
    readonly representation: RepresentationRef
    readonly revision: Frame["representationChangedByChangeId"]
    readonly generation: number
    readonly resolver: FrameRepresentationResolver
    readonly plan: RenderPlan
  }
  | {
    readonly _tag: "failed"
    readonly representation: RepresentationRef
    readonly revision: Frame["representationChangedByChangeId"]
    readonly generation: number
    readonly resolver: FrameRepresentationResolver
  }

type RenderAction = RenderState

const transition = (state: RenderState, action: RenderAction): RenderState => {
  if (
    action._tag !== "resolving" &&
    (
      state.revision !== action.revision ||
      state.representation !== action.representation ||
      state.generation !== action.generation ||
      state.resolver !== action.resolver
    )
  ) {
    return state
  }
  return action
}

const representationsEqual = Schema.toEquivalence(RepresentationRefSchema)

const unavailableCopy = (
  title: Frame["title"],
  plan: Extract<RenderPlan, { readonly _tag: "unavailable" }>
) => {
  switch (plan.reason) {
    case "application-unbound":
      return `${title} is unavailable because its application is not bound in this environment.`
    case "artifact-not-found":
      return `${title} is unavailable because its artifact was not found.`
    case "artifact-corrupt":
      return `${title} is unavailable because its artifact failed its integrity check.`
  }
}

function ArtifactDownload({
  className,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly plan: Extract<RenderPlan, { readonly _tag: "artifact-bytes" }>
  readonly title: Frame["title"]
}) {
  const artifactKey = `${plan.representation.artifactId}:${plan.representation.digest}`
  const [download, setDownload] = useState<{
    readonly artifactKey: string
    readonly bytes: Uint8Array
    readonly href: string
  }>()

  useEffect(() => {
    const href = URL.createObjectURL(new Blob(
      [new Uint8Array(plan.bytes)],
      { type: "application/octet-stream" }
    ))
    setDownload({ artifactKey, bytes: plan.bytes, href })
    return () => URL.revokeObjectURL(href)
  }, [artifactKey, plan.bytes])

  if (download?.artifactKey !== artifactKey || download.bytes !== plan.bytes) {
    return <div className={className} role="status">Preparing {title} for download.</div>
  }

  return <a
    className={className}
    download={plan.representation.artifactId}
    href={download.href}
  >Download {title}</a>
}

const ResolvedFrame = ({
  className,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly plan: RenderPlan
  readonly title: Frame["title"]
}): ReactElement => Match.value(plan).pipe(Match.tagsExhaustive({
  iframe: (iframe) => <iframe
    className={className}
    referrerPolicy="no-referrer"
    src={iframe.url}
    title={title}
  />,
  "artifact-bytes": (artifact) => <ArtifactDownload
    className={className}
    plan={artifact}
    title={title}
  />,
  unavailable: (unavailable) => <div className={className} role="status">
    {unavailableCopy(title, unavailable)}
  </div>
}))

export function FrameRenderer({
  className,
  frame,
  resolver
}: FrameRendererProps): ReactElement {
  const generation = useRef(0)
  const stableRepresentation = useRef(frame.representation)
  if (!representationsEqual(stableRepresentation.current, frame.representation)) {
    stableRepresentation.current = frame.representation
  }
  const representation = stableRepresentation.current
  const [state, dispatch] = useReducer(transition, {
    _tag: "resolving",
    representation,
    revision: frame.representationChangedByChangeId,
    generation: generation.current,
    resolver
  })

  useEffect(() => {
    generation.current += 1
    const requestGeneration = generation.current
    const revision = frame.representationChangedByChangeId
    dispatch({
      _tag: "resolving",
      representation,
      revision,
      generation: requestGeneration,
      resolver
    })
    const fiber = Effect.runFork(resolver.resolve(representation).pipe(Effect.match({
      onFailure: () => dispatch({
        _tag: "failed",
        representation,
        revision,
        generation: requestGeneration,
        resolver
      }),
      onSuccess: (plan) => dispatch({
        _tag: "resolved",
        representation,
        revision,
        generation: requestGeneration,
        resolver,
        plan
      })
    })))
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [
    frame.representationChangedByChangeId,
    representation,
    resolver
  ])

  if (
    state.revision !== frame.representationChangedByChangeId ||
    state.representation !== representation ||
    state.resolver !== resolver
  ) {
    return <div className={className} role="status">Loading {frame.title}.</div>
  }

  return Match.value(state).pipe(Match.tagsExhaustive({
    resolving: () => <div className={className} role="status">Loading {frame.title}.</div>,
    resolved: ({ plan }) => <ResolvedFrame className={className} plan={plan} title={frame.title} />,
    failed: () => <div className={className} role="alert">Could not load {frame.title}.</div>
  }))
}
