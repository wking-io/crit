import type { ReactElement, Ref } from "react"

export function UnsandboxedLiveReviewIframe({
  className,
  iframeRef,
  src,
  title
}: {
  readonly className: string | undefined
  readonly iframeRef: Ref<HTMLIFrameElement>
  readonly src: string
  readonly title: string
}): ReactElement {
  return (
    <iframe
      className={className}
      ref={iframeRef}
      referrerPolicy="no-referrer"
      src={src}
      title={title}
    />
  )
}
