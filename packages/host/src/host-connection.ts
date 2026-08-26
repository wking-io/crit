import {
  LocalBrowserConnection,
  type LocalBrowserConnectionDescriptor
} from "@crit/client"
import { Data, Result } from "effect"

export type HostConnection = Data.TaggedEnum<{
  readonly local: {
    readonly descriptor: LocalBrowserConnectionDescriptor
  }
  readonly hosted: {}
  readonly invalid: {
    readonly reason: string
  }
}>
export const HostConnection = Data.taggedEnum<HostConnection>()

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

export const parseHostConnection = ({
  fragment,
  origin
}: {
  readonly fragment: string
  readonly origin: string
}): HostConnection => {
  if (fragment.startsWith("#crit=")) {
    return Result.match(LocalBrowserConnection.decode(fragment), {
      onFailure: (failure) => HostConnection.invalid({
        reason: failure.reason
      }),
      onSuccess: (descriptor) => HostConnection.local({ descriptor })
    })
  }
  return isHostedOrigin(origin)
    ? HostConnection.hosted()
    : HostConnection.invalid({
      reason: "Hosted mode requires a non-loopback HTTPS origin."
    })
}
