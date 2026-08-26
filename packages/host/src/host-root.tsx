import type { CanvasId } from "@crit/domain"
import { RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Match } from "effect"
import { type ReactElement } from "react"

import { CritHost } from "./crit-host.js"
import { hostIndexAtom, hostScreenAtom } from "./host-atoms.js"
import { HostCanvasList } from "./host-canvas-list.js"
import { parseHostLocation } from "./host-canvas-id.js"

const registryIdleTtlMs = 400

function HostScreenView({ canvasId, fragment }: {
  readonly canvasId: CanvasId
  readonly fragment: string
}): ReactElement {
  const screen = useAtomValue(hostScreenAtom(fragment)(canvasId))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: () => <p role="alert">Unable to connect to Crit.</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    ready: ({ props }) => <CritHost {...props} />
  }))
}

function HostIndexView({ fragment }: {
  readonly fragment: string
}): ReactElement {
  const screen = useAtomValue(hostIndexAtom(fragment))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: () => <p role="alert">Unable to connect to Crit.</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    failed: ({ reason }) => <p role="alert">{reason}</p>,
    ready: ({ listings }) => <HostCanvasList fragment={fragment} listings={listings} />
  }))
}

export function HostRoot({ fragment, search }: {
  readonly fragment: string
  readonly search: string
}): ReactElement {
  return Match.value(parseHostLocation(search)).pipe(Match.tagsExhaustive({
    invalid: () => <p role="alert">That is not a Canvas ID.</p>,
    index: () => (
      <RegistryProvider defaultIdleTTL={registryIdleTtlMs}>
        <HostIndexView fragment={fragment} />
      </RegistryProvider>
    ),
    canvas: ({ canvasId }) => (
      <RegistryProvider defaultIdleTTL={registryIdleTtlMs}>
        <HostScreenView canvasId={canvasId} fragment={fragment} />
      </RegistryProvider>
    )
  }))
}
