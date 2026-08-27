import { LocalBrowserConnection } from "@crit/client"
import type { CanvasId } from "@crit/domain"
import { useAtomValue } from "@effect/atom-react"
import { Match } from "effect"
import { type ReactElement } from "react"

import { CritHost } from "./crit-host.js"
import { sessionHash } from "./host-canvas-id.js"
import type { HostRuntime } from "./host-connection.js"
import { hostIndexAtom, hostScreenAtom } from "./host-atoms.js"
import { HostCanvasList } from "./host-canvas-list.js"

export function HostScreenView({ canvasId, runtime }: {
  readonly canvasId: CanvasId
  readonly runtime: HostRuntime
}): ReactElement {
  const screen = useAtomValue(hostScreenAtom(runtime)(canvasId))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: ({ reason }) => <p role="alert">{reason}</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    ready: ({ props }) => <CritHost {...props} />
  }))
}

export function HostIndexView({ runtime }: {
  readonly runtime: HostRuntime
}): ReactElement {
  const screen = useAtomValue(hostIndexAtom(runtime))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: ({ reason }) => <p role="alert">{reason}</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    failed: ({ reason }) => <p role="alert">{reason}</p>,
    ready: ({ listings }) => (
      <HostCanvasList
        listings={listings}
        sessionHash={
          runtime._tag === "standalone"
            ? sessionHash(LocalBrowserConnection.encode(runtime.descriptor))
            : undefined
        }
      />
    )
  }))
}
