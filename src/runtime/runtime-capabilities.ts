export interface RuntimeCapabilities {
  readonly confirm: (message: string) => boolean | undefined
  readonly document: () => Document | undefined
  readonly now: () => number
  readonly platform: () => string
  readonly random: () => number
  readonly randomUUID: () => string | undefined
  readonly sessionStorage: () =>
    | Pick<Storage, "getItem" | "setItem">
    | undefined
}

const browserDocument = (): Document | undefined => globalThis.document

const browserWindow = (): Window | undefined => {
  const document = browserDocument()
  return document === undefined ? undefined : document.defaultView ?? undefined
}

export const defaultRuntimeCapabilities: RuntimeCapabilities = {
  confirm: (message) => browserWindow()?.confirm(message),
  document: browserDocument,
  now: Date.now,
  platform: () => browserWindow()?.navigator.platform ?? "",
  random: Math.random,
  randomUUID: () => globalThis.crypto?.randomUUID?.(),
  sessionStorage: () => browserWindow()?.sessionStorage
}

export type RuntimeIdSource = Pick<
  RuntimeCapabilities,
  "now" | "random" | "randomUUID"
>

export const runtimeId = (
  prefix: string,
  runtime: RuntimeIdSource = defaultRuntimeCapabilities
) => {
  const uuid = runtime.randomUUID()
  return `${prefix}-${
    uuid ?? `${runtime.now()}-${runtime.random().toString(36).slice(2)}`
  }`
}
