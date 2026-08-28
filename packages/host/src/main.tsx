import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { readInjectedHostRuntime, resolveHostRuntime } from "./host-connection.js"
import { HostRoot } from "./host-root.js"

const container = document.getElementById("root")
if (container !== null) {
  const runtime = resolveHostRuntime({
    origin: window.location.origin,
    fragment: window.location.hash,
    injected: readInjectedHostRuntime(document)
  })
  createRoot(container).render(
    <StrictMode>
      <HostRoot runtime={runtime} />
    </StrictMode>
  )
}
