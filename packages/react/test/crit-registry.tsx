import { RegistryProvider } from "@effect/atom-react"

import { scheduleCritRegistryTask } from "../src/registry-schedule.js"
import type { ReactElement, ReactNode } from "react"

export function CritRegistry({ children }: {
  readonly children: ReactNode
}): ReactElement {
  return (
    <RegistryProvider scheduleTask={scheduleCritRegistryTask}>
      {children}
    </RegistryProvider>
  )
}
