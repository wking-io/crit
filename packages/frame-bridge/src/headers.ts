import type { FrameBridgeOrigin } from "@crit/protocol"

export const renderFrameAncestorsContentSecurityPolicy = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}): string => `frame-ancestors ${input.parentOrigin}`

export const renderFrameAncestorsResponseHeaders = (input: {
  readonly parentOrigin: FrameBridgeOrigin
}) => ({
  "content-security-policy": renderFrameAncestorsContentSecurityPolicy(input)
})

export const renderCloudflarePagesHeadersFile = (input: {
  readonly parentOrigin: FrameBridgeOrigin
  readonly path?: string
}): string => {
  const assetPath = input.path ?? "/*"
  const policy = renderFrameAncestorsContentSecurityPolicy(input)
  return `${assetPath}\n  Content-Security-Policy: ${policy}\n`
}

export const frameAncestorsNamesOrigin = (
  contentSecurityPolicy: string | null | undefined,
  parentOrigin: FrameBridgeOrigin
): boolean => {
  if (contentSecurityPolicy === null || contentSecurityPolicy === undefined) {
    return false
  }
  return contentSecurityPolicy.includes("frame-ancestors")
    && contentSecurityPolicy.includes(parentOrigin)
}
