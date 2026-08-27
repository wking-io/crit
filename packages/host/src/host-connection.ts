import {
  BrowserOrigin,
  IntegratedApiBase,
  IntegratedConnectionDocument,
  LocalBrowserConnection,
  LocalClientOptions,
  type LocalBrowserConnectionDescriptor
} from "@crit/client"
import { Data, Option, Result, Schema } from "effect"

export type HostRuntime = Data.TaggedEnum<{
  readonly integrated: {
    readonly origin: typeof BrowserOrigin.Type
    readonly apiBase: IntegratedApiBase
  }
  readonly standalone: {
    readonly descriptor: LocalBrowserConnectionDescriptor
  }
  readonly hosted: {}
  readonly invalid: { readonly reason: string }
}>
export const HostRuntime = Data.taggedEnum<HostRuntime>()

const isHostedOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin)
    return parsed.origin === origin &&
      parsed.protocol === "https:" &&
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "localhost"
  } catch {
    return false
  }
}

export const readInjectedHostRuntime = (
  document: Document
): IntegratedConnectionDocument | undefined => {
  const node = document.getElementById("crit-host-runtime")
  if (node === null || node.textContent === null) return undefined
  try {
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(IntegratedConnectionDocument)(JSON.parse(node.textContent))
    )
  } catch {
    return undefined
  }
}

export const resolveHostRuntime = (input: {
  readonly origin: string
  readonly fragment: string
  readonly injected?: IntegratedConnectionDocument | undefined
}): HostRuntime => {
  const loopback = Schema.decodeUnknownOption(BrowserOrigin)(input.origin)
  if (Option.isSome(loopback) && input.injected !== undefined) {
    return HostRuntime.integrated({
      origin: loopback.value,
      apiBase: input.injected.apiBase
    })
  }
  if (input.fragment.startsWith("#crit=")) {
    return Result.match(LocalBrowserConnection.decode(input.fragment), {
      onFailure: (failure) => HostRuntime.invalid({ reason: failure.reason }),
      onSuccess: (descriptor) => HostRuntime.standalone({ descriptor })
    })
  }
  if (isHostedOrigin(input.origin)) return HostRuntime.hosted()
  if (Option.isSome(loopback)) {
    return HostRuntime.invalid({
      reason: "This Crit host is not connected. Run crit dev."
    })
  }
  return HostRuntime.invalid({
    reason: "Hosted mode requires a non-loopback HTTPS origin."
  })
}

export const localClientOptionsFor = (
  runtime: Extract<HostRuntime, { readonly _tag: "integrated" | "standalone" }>
): LocalClientOptions => {
  if (runtime._tag === "integrated") {
    return LocalClientOptions.integrated({
      origin: runtime.origin,
      apiBase: runtime.apiBase
    })
  }
  return LocalBrowserConnection.options(runtime.descriptor)
}
