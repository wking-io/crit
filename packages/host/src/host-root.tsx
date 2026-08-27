import { scheduleCritRegistryTask } from "@crit/react"
import { RegistryProvider } from "@effect/atom-react"
import { type ReactElement } from "react"
import type { RouterHistory } from "@tanstack/react-router"

import type { HostRuntime } from "./host-connection.js"
import { HostRouter } from "./host-router.js"

const registryIdleTtlMs = 400

export function HostRoot({ history, runtime }: {
  readonly history?: RouterHistory | undefined
  readonly runtime: HostRuntime
}): ReactElement {
  return (
    <RegistryProvider
      defaultIdleTTL={registryIdleTtlMs}
      scheduleTask={scheduleCritRegistryTask}
    >
      <HostRouter history={history} runtime={runtime} />
    </RegistryProvider>
  )
}
