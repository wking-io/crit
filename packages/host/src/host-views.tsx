import type { CanvasId } from "@crit/domain"
import { useAtomValue } from "@effect/atom-react"
import { Match } from "effect"
import { type ReactElement } from "react"

import { CritHost } from "./crit-host.js"
import { hostIndexAtom, hostScreenAtom } from "./host-atoms.js"
import { HostCanvasList } from "./host-canvas-list.js"

export function HostScreenView({ canvasId, fragment, origin }: {
  readonly canvasId: CanvasId
  readonly fragment: string
  readonly origin: string
}): ReactElement {
  const screen = useAtomValue(hostScreenAtom(fragment)(origin)(canvasId))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: ({ reason }) => <p role="alert">{reason}</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    ready: ({ props }) => <CritHost {...props} />
  }))
}

export function HostIndexView({ fragment, origin }: {
  readonly fragment: string
  readonly origin: string
}): ReactElement {
  const screen = useAtomValue(hostIndexAtom(fragment)(origin))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: ({ reason }) => <p role="alert">{reason}</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    failed: ({ reason }) => <p role="alert">{reason}</p>,
    ready: ({ listings }) => <HostCanvasList fragment={fragment} listings={listings} />
  }))
}
