import { Match } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type ReactElement
} from "react"

import { CritHost } from "./crit-host.js"
import { hostScreenAtom, localCanvasId, type HostScreen } from "./host-atoms.js"

export { localCanvasId }

function useHostScreen(fragment: string): HostScreen {
  const lease = useRef<AtomRegistry.AtomRegistry | null>(null)
  const acquire = () => {
    if (lease.current === null) {
      lease.current = AtomRegistry.make()
    }
    return lease.current
  }
  const atom = hostScreenAtom(fragment)
  const subscribe = useCallback((onStoreChange: () => void) => {
    const registry = acquire()
    const unsubscribe = registry.subscribe(atom, onStoreChange)
    return () => {
      unsubscribe()
      registry.dispose()
      if (lease.current === registry) {
        lease.current = null
      }
    }
  }, [atom])
  return useSyncExternalStore(
    subscribe,
    () => acquire().get(atom),
    () => acquire().get(atom)
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
