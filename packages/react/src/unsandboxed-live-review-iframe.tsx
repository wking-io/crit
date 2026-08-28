import type { ReactElement, Ref } from "react"

export function UnsandboxedLiveReviewIframe({
  className,
  iframeRef,
  paused = false,
  src,
  title
}: {
  readonly className: string | undefined
  readonly iframeRef: Ref<HTMLIFrameElement>
  readonly paused?: boolean
  readonly src: string
  readonly title: string
}): ReactElement {
  return (
    <iframe
      className={className}
      data-paused={paused || undefined}
      ref={iframeRef}
      referrerPolicy="no-referrer"
      src={src}
      title={title}
    />
  )
}
