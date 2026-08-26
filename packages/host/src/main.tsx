import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { HostRoot } from "./host-root.js"

const container = document.getElementById("root")
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <HostRoot fragment={window.location.hash} />
    </StrictMode>
  )
}
