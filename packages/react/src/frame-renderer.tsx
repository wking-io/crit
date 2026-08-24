import {
  type CommentThread,
  type Frame,
  type HttpUrl,
  type RepresentationRef
} from "@crit/domain"
import {
  connectBridgedFrameComments,
  connectBridgedFrameInput,
  critFrameInputBridgeScript,
  frameBridgeOriginFromHref
} from "@crit/frame-bridge"
import {
  FrameBridgeOrigin,
  FrameCommentPinSchema,
  type FrameCommentPin,
  type FrameInputIntent
} from "@crit/protocol"
import type { RenderPlan } from "@crit/representations"
import { useQuery } from "@tanstack/react-query"
import { Effect, Match, Option, Schema } from "effect"
import {
  useEffect,
  useRef,
  useState,
  type ReactElement
} from "react"

import { UnsandboxedLiveReviewIframe } from "./unsandboxed-live-review-iframe.js"

export type FrameRendererFrame = Pick<
  Frame,
  "title" | "representation" | "representationChangedByChangeId"
>

export interface FrameRepresentationResolver {
  readonly resolve: (
    representation: RepresentationRef
  ) => Effect.Effect<RenderPlan, unknown>
}

const noCommentThreads: readonly CommentThread[] = []

export interface FrameRendererProps {
  readonly frame: FrameRendererFrame
  readonly resolver: FrameRepresentationResolver
  readonly commentThreads?: readonly CommentThread[]
  readonly className?: string
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly paused?: boolean
}

let nextResolverId = 0
const resolverIds = new WeakMap<FrameRepresentationResolver, number>()

const resolverId = (resolver: FrameRepresentationResolver) => {
  const existing = resolverIds.get(resolver)
  if (existing !== undefined) return existing
  nextResolverId += 1
  resolverIds.set(resolver, nextResolverId)
  return nextResolverId
}

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

const frameOrigin = (url: string): FrameBridgeOrigin | undefined => {
  try {
    return Schema.decodeUnknownSync(FrameBridgeOrigin)(new URL(url).origin)
  } catch {
    return undefined
  }
}

const liveCommentPins = (
  threads: readonly CommentThread[],
  documentUrl: HttpUrl
): readonly FrameCommentPin[] =>
  threads.flatMap((thread) => {
    if (thread.anchor._tag !== "element") return []
    return [Schema.decodeUnknownSync(FrameCommentPinSchema)({
      id: thread.threadId,
      anchor: {
        kind: "element",
        documentUrl,
        selector: thread.anchor.selector,
        fingerprint: thread.anchor.fingerprint,
        point: thread.anchor.point
      }
    })]
  })

function LiveFrame({
  className,
  commentThreads,
  onInputIntent,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly commentThreads: readonly CommentThread[]
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly plan: Extract<RenderPlan, { readonly _tag: "iframe" }>
  readonly title: Frame["title"]
}): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    const origin = frameOrigin(plan.url)
    if (iframe === null || origin === undefined) return
    const bridge = connectBridgedFrameComments({
      target: window,
      frameElement: iframe,
      frameOrigin: origin,
      onEvent: () => undefined
    })
    const configure = () => {
      bridge.configure({
        activeId: null,
        color: "#111111",
        enabled: false,
        pins: liveCommentPins(commentThreads, plan.url)
      })
    }
    iframe.addEventListener("load", configure)
    configure()
    return () => {
      iframe.removeEventListener("load", configure)
      bridge.disconnect()
    }
  }, [commentThreads, plan.url])

  useEffect(() => {
    if (onInputIntent === undefined) return
    const iframe = iframeRef.current
    const origin = frameOrigin(plan.url)
    if (iframe === null || origin === undefined) return
    const disconnect = connectBridgedFrameInput({
      target: window,
      frameElement: iframe,
      frameOrigin: origin,
      onIntent: onInputIntent
    })
    const parentOrigin = Option.getOrUndefined(
      frameBridgeOriginFromHref(window.location.href)
    )
    const inject = () => {
      if (parentOrigin === undefined) return
      try {
        const frameDocument = iframe.contentDocument
        if (
          frameDocument === null ||
          frameDocument.querySelector("script[data-crit-input-bridge]") !== null
        ) return
        const script = frameDocument.createElement("script")
        script.dataset.critInputBridge = ""
        script.textContent = critFrameInputBridgeScript({ parentOrigin })
        frameDocument.documentElement.append(script)
      } catch {
        return
      }
    }
    iframe.addEventListener("load", inject)
    inject()
    return () => {
      iframe.removeEventListener("load", inject)
      disconnect()
    }
  }, [onInputIntent, plan.url])

  return (
    <UnsandboxedLiveReviewIframe
      className={className}
      iframeRef={iframeRef}
      src={plan.url}
      title={title}
    />
  )
}

const ResolvedFrame = ({
  className,
  commentThreads,
  onInputIntent,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly commentThreads: readonly CommentThread[]
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly plan: RenderPlan
  readonly title: Frame["title"]
}): ReactElement => Match.value(plan).pipe(Match.tagsExhaustive({
  iframe: (iframe) => (
    <LiveFrame
      className={className}
      commentThreads={commentThreads}
      {...(onInputIntent === undefined ? {} : { onInputIntent })}
      plan={iframe}
      title={title}
    />
  ),
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
  commentThreads = noCommentThreads,
  frame,
  onInputIntent,
  paused = false,
  resolver
}: FrameRendererProps): ReactElement {
  const query = useQuery({
    queryKey: [
      "crit",
      "frame-render-plan",
      resolverId(resolver),
      frame.representationChangedByChangeId,
      frame.representation
    ],
    queryFn: ({ signal }) => Effect.runPromise(
      resolver.resolve(frame.representation),
      { signal }
    ),
    enabled: !paused,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY
  })

  if (paused) {
    return <div className={className} role="status">{frame.title} is paused.</div>
  }

  if (query.isPending) {
    return <div className={className} role="status">Loading {frame.title}.</div>
  }

  if (query.isError) {
    return <div className={className} role="alert">Could not load {frame.title}.</div>
  }

  return (
    <ResolvedFrame
      className={className}
      commentThreads={commentThreads}
      {...(onInputIntent === undefined ? {} : { onInputIntent })}
      plan={query.data}
      title={frame.title}
    />
  )
}
