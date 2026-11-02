import { installCanvasPerformanceProbe, recordCanvasReactCommit } from "@crit/react"
import { Profiler, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { readInjectedHostRuntime, resolveHostRuntime } from "./host-connection.js"
import { HostRoot } from "./host-root.js"

const container = document.getElementById("root")
if (container !== null) {
  installCanvasPerformanceProbe()
  const runtime = resolveHostRuntime({
    origin: window.location.origin,
    fragment: window.location.hash,
    injected: readInjectedHostRuntime(document)
  })
  createRoot(container).render(
    <StrictMode>
      <Profiler id="crit-host" onRender={(_id, _phase, duration) => {
        recordCanvasReactCommit(duration)
      }}>
        <HostRoot runtime={runtime} />
      </Profiler>
    </StrictMode>
  )
}
