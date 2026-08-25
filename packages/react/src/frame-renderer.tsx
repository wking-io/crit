import {
  type Frame,
  type RepresentationRef
} from "@crit/domain"
import {
  connectBridgedFrameInput,
  critFrameInputBridgeScript,
  frameBridgeOriginFromHref
} from "@crit/frame-bridge"
import {
  FrameBridgeOrigin,
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

export interface FrameRendererProps {
  readonly frame: FrameRendererFrame
  readonly resolver: FrameRepresentationResolver
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

const artifactLooksLikeHtml = (bytes: Uint8Array): boolean => {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1_024))
  return /^(?:<!doctype html|<html)/i.test(
    prefix.replace(/^\uFEFF/, "").trimStart()
  )
}

function ArtifactContent({
  className,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly plan: Extract<RenderPlan, { readonly _tag: "artifact-bytes" }>
  readonly title: Frame["title"]
}) {
  const artifactKey = `${plan.representation.artifactId}:${plan.representation.digest}`
  const html = artifactLooksLikeHtml(plan.bytes)
  const [content, setContent] = useState<{
    readonly artifactKey: string
    readonly bytes: Uint8Array
    readonly html: boolean
    readonly href: string
  }>()

  useEffect(() => {
    const href = URL.createObjectURL(new Blob(
      [new Uint8Array(plan.bytes)],
      { type: html ? "text/html" : "application/octet-stream" }
    ))
    setContent({ artifactKey, bytes: plan.bytes, html, href })
    return () => URL.revokeObjectURL(href)
  }, [artifactKey, html, plan.bytes])

  if (
    content?.artifactKey !== artifactKey ||
    content.bytes !== plan.bytes ||
    content.html !== html
  ) {
    return <div className={className} role="status">Preparing {title}.</div>
  }

  if (html) {
    return <iframe
      className={className}
      sandbox="allow-scripts"
      src={content.href}
      title={title}
    />
  }

  return <a
    className={className}
    download={plan.representation.artifactId}
    href={content.href}
  >Download {title}</a>
}

const frameOrigin = (url: string): FrameBridgeOrigin | undefined => {
  try {
    return Schema.decodeUnknownSync(FrameBridgeOrigin)(new URL(url).origin)
  } catch {
    return undefined
  }
}

function LiveFrame({
  className,
  onInputIntent,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly plan: Extract<RenderPlan, { readonly _tag: "iframe" }>
  readonly title: Frame["title"]
}): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null)

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
  onInputIntent,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly plan: RenderPlan
  readonly title: Frame["title"]
}): ReactElement => Match.value(plan).pipe(Match.tagsExhaustive({
  iframe: (iframe) => (
    <LiveFrame
      className={className}
      {...(onInputIntent === undefined ? {} : { onInputIntent })}
      plan={iframe}
      title={title}
    />
  ),
  "artifact-bytes": (artifact) => <ArtifactContent
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
      {...(onInputIntent === undefined ? {} : { onInputIntent })}
      plan={query.data}
      title={frame.title}
    />
  )
}
