import { RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Match } from "effect"
import { type ReactElement } from "react"

import { CritHost } from "./crit-host.js"
import { hostScreenAtom, localCanvasId } from "./host-atoms.js"

export { localCanvasId }

const registryIdleTtlMs = 400

function HostScreenView({ fragment }: { readonly fragment: string }): ReactElement {
  const screen = useAtomValue(hostScreenAtom(fragment))
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: () => <p role="alert">Unable to connect to Crit.</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    ready: ({ props }) => <CritHost {...props} />
  }))
}

export function HostRoot({ fragment }: { readonly fragment: string }): ReactElement {
  return (
    <RegistryProvider defaultIdleTTL={registryIdleTtlMs}>
      <HostScreenView fragment={fragment} />
    </RegistryProvider>
  )
}
