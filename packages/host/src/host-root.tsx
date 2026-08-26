import { RegistryProvider } from "@effect/atom-react"
import { type ReactElement } from "react"
import type { RouterHistory } from "@tanstack/react-router"

import { HostRouter } from "./host-router.js"

const registryIdleTtlMs = 400

export function HostRoot({ fragment, history, origin }: {
  readonly fragment: string
  readonly history?: RouterHistory | undefined
  readonly origin: string
}): ReactElement {
  return (
    <RegistryProvider defaultIdleTTL={registryIdleTtlMs}>
      <HostRouter fragment={fragment} history={history} origin={origin} />
    </RegistryProvider>
  )
}
