import {
  type Frame,
  type RepresentationRef
} from "@crit/domain"
import {
  FRAME_ROUTE_BRIDGE_HTML_MARKER,
  connectBridgedFrameInput,
  connectLiveFrameRoute,
  critFrameInputBridgeScript,
  critFrameRouteBridgeScript,
  frameBridgeOriginFromHref
} from "@crit/frame-bridge"
import {
  FrameBridgeOrigin,
  type FrameInputIntent
} from "@crit/protocol"
import type { RenderPlan } from "@crit/representations"
import { useAtomValue } from "@effect/atom-react"
import { Effect, Match, Option, Schema } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import {
  useEffect,
  useRef,
  useState,
  type ReactElement
} from "react"

import { frameRenderPlanFor } from "./frame-render-plan.js"
import { connectIframeContextMenu } from "./iframe-context-menu.js"
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
  readonly onRouteChange?: (route: string) => void
  readonly paused?: boolean
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
  paused,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly paused: boolean
  readonly plan: Extract<RenderPlan, { readonly _tag: "artifactBytes" }>
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
      data-paused={paused || undefined}
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
  onRouteChange,
  paused,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly onRouteChange?: (route: string) => void
  readonly paused: boolean
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

  useEffect(() => {
    if (onRouteChange === undefined) return
    const iframe = iframeRef.current
    const origin = frameOrigin(plan.url)
    if (iframe === null || origin === undefined) return
    const disconnect = connectLiveFrameRoute({
      target: window,
      frameElement: iframe,
      frameOrigin: origin,
      onRoute: onRouteChange
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
          frameDocument.querySelector(
            `script[${FRAME_ROUTE_BRIDGE_HTML_MARKER}]`
          ) !== null
        ) return
        const script = frameDocument.createElement("script")
        script.setAttribute(FRAME_ROUTE_BRIDGE_HTML_MARKER, "")
        script.textContent = critFrameRouteBridgeScript({ parentOrigin })
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
  }, [onRouteChange, plan.url])

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe === null) return
    return connectIframeContextMenu(iframe)
  }, [plan.url])

  return (
    <UnsandboxedLiveReviewIframe
      className={className}
      iframeRef={iframeRef}
      paused={paused}
      src={plan.url}
      title={title}
    />
  )
}

const ResolvedFrame = ({
  className,
  onInputIntent,
  onRouteChange,
  paused,
  plan,
  title
}: {
  readonly className: string | undefined
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly onRouteChange?: (route: string) => void
  readonly paused: boolean
  readonly plan: RenderPlan
  readonly title: Frame["title"]
}): ReactElement => Match.value(plan).pipe(Match.tagsExhaustive({
  iframe: (iframe) => (
    <LiveFrame
      className={className}
      {...(onInputIntent === undefined ? {} : { onInputIntent })}
      {...(onRouteChange === undefined ? {} : { onRouteChange })}
      paused={paused}
      plan={iframe}
      title={title}
    />
  ),
  "artifactBytes": (artifact) => <ArtifactContent
    className={className}
    paused={paused}
    plan={artifact}
    title={title}
  />,
  unavailable: (unavailable) => <div className={className} role="status">
    {unavailableCopy(title, unavailable)}
  </div>
}))

function ActiveFrameRenderer({
  className,
  frame,
  onInputIntent,
  onRouteChange,
  paused,
  resolver
}: {
  readonly className?: string | undefined
  readonly frame: FrameRendererFrame
  readonly resolver: FrameRepresentationResolver
  readonly onInputIntent?: (intent: FrameInputIntent) => void
  readonly onRouteChange?: (route: string) => void
  readonly paused: boolean
}): ReactElement {
  const plan = useAtomValue(frameRenderPlanFor(resolver, frame))
  return AsyncResult.match(plan, {
    onInitial: () => (
      <div className={className} role="status">Loading {frame.title}.</div>
    ),
    onFailure: () => (
      <div className={className} role="alert">Could not load {frame.title}.</div>
    ),
    onSuccess: ({ value }) => (
      <ResolvedFrame
        className={className}
        {...(onInputIntent === undefined ? {} : { onInputIntent })}
        {...(onRouteChange === undefined ? {} : { onRouteChange })}
        paused={paused}
        plan={value}
        title={frame.title}
      />
    )
  })
}

export function FrameRenderer({
  className,
  frame,
  onInputIntent,
  onRouteChange,
  paused = false,
  resolver
}: FrameRendererProps): ReactElement {
  return (
    <>
      <ActiveFrameRenderer
        {...(className === undefined ? {} : { className })}
        frame={frame}
        {...(onInputIntent === undefined ? {} : { onInputIntent })}
        {...(onRouteChange === undefined ? {} : { onRouteChange })}
        paused={paused}
        resolver={resolver}
      />
      {paused
        ? (
          <div className="crit-frame__paused" role="status">
            Frame paused while offscreen
          </div>
        )
        : null}
    </>
  )
}
