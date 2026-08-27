import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode
} from "react"

import {
  CanvasInputTarget,
  CanvasSelection,
  type CanvasItemRef
} from "./canvas-selection.js"
import type { FrameId } from "@crit/domain"

export interface CanvasSelectionStore {
  readonly get: () => CanvasSelection
  readonly set: (selection: CanvasSelection) => void
  readonly subscribe: (listener: () => void) => () => void
}

export const createCanvasSelectionStore = (
  initial: CanvasSelection
): CanvasSelectionStore => {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (selection) => {
      if (CanvasSelection.equal(current, selection)) return
      current = selection
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

const SelectionStoreContext = createContext<CanvasSelectionStore | null>(null)
const subscribeNever = () => () => undefined

export function CanvasSelectionStoreProvider({
  children,
  store
}: {
  readonly children: ReactNode
  readonly store: CanvasSelectionStore
}): ReactElement {
  return (
    <SelectionStoreContext.Provider value={store}>
      {children}
    </SelectionStoreContext.Provider>
  )
}

export const useOptionalSelectionStore = (): CanvasSelectionStore | null =>
  useContext(SelectionStoreContext)

export const useLiveCanvasSelection = (
  fallback: CanvasSelection
): CanvasSelection => {
  const store = useOptionalSelectionStore()
  return useSyncExternalStore(
    store?.subscribe ?? subscribeNever,
    () => store?.get() ?? fallback,
    () => store?.get() ?? fallback
  )
}

export const useItemSelected = (
  item: CanvasItemRef,
  fallback: boolean
): boolean => {
  const store = useOptionalSelectionStore()
  return useSyncExternalStore(
    store?.subscribe ?? subscribeNever,
    () => store === null ? fallback : CanvasSelection.has(store.get(), item),
    () => store === null ? fallback : CanvasSelection.has(store.get(), item)
  )
}

export const useFrameIsInputTarget = (
  frameId: FrameId,
  fallback: boolean
): boolean => {
  const store = useOptionalSelectionStore()
  return useSyncExternalStore(
    store?.subscribe ?? subscribeNever,
    () => {
      if (store === null) return fallback
      const target = CanvasSelection.inputTarget(store.get())
      return CanvasInputTarget.$is("frame")(target) && target.frameId === frameId
    },
    () => {
      if (store === null) return fallback
      const target = CanvasSelection.inputTarget(store.get())
      return CanvasInputTarget.$is("frame")(target) && target.frameId === frameId
    }
  )
}
