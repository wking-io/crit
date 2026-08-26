import type { CanvasId } from "@crit/domain"
import { RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Match, Result } from "effect"
import { type ReactElement } from "react"

import { CritHost } from "./crit-host.js"
import { hostScreenAtom } from "./host-atoms.js"
import { parseHostCanvasId } from "./host-canvas-id.js"

export { localCanvasId } from "./host-canvas-id.js"

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

export function HostRoot({ fragment, search }: {
  readonly fragment: string
  readonly search: string
}): ReactElement {
  return Result.match(parseHostCanvasId(search), {
    onFailure: () => <p role="alert">That is not a Canvas ID.</p>,
    onSuccess: (canvasId) => (
      <RegistryProvider defaultIdleTTL={registryIdleTtlMs}>
        <HostScreenView canvasId={canvasId} fragment={fragment} />
      </RegistryProvider>
    )
  })
}
