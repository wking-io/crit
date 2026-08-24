import { Match } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactElement
} from "react"

import { CritHost } from "./crit-host.js"
import { hostScreenAtom, localCanvasId, type HostScreen } from "./host-atoms.js"

export { localCanvasId }

function useHostScreen(fragment: string): HostScreen {
  const slot = useRef<{
    readonly registry: AtomRegistry.AtomRegistry
    live: boolean
  }>({
    registry: AtomRegistry.make(),
    live: true
  })
  const registry = (): AtomRegistry.AtomRegistry => {
    if (!slot.current.live) {
      slot.current = { registry: AtomRegistry.make(), live: true }
    }
    return slot.current.registry
  }
  useEffect(() => () => {
    slot.current.registry.dispose()
    slot.current.live = false
  }, [])
  const atom = hostScreenAtom(fragment)
  return useSyncExternalStore(
    (onStoreChange) => registry().subscribe(atom, onStoreChange),
    () => registry().get(atom),
    () => registry().get(atom)
  )
}

export function HostRoot({ fragment }: { readonly fragment: string }): ReactElement {
  const screen = useHostScreen(fragment)
  return Match.value(screen).pipe(Match.tagsExhaustive({
    invalid: () => <p role="alert">Unable to connect to Crit.</p>,
    connecting: () => <p role="status">Connecting to Crit…</p>,
    ready: ({ props }) => <CritHost {...props} />
  }))
}
