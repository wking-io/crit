import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { GlyphProvider } from "@riff-refine/crit"

import { launchPageFromPath } from "./pages.js"
import { LaunchSite } from "./site.js"
import "./styles.css"

function App() {
  const pathname = new URL(window.location.href).pathname
  const page = launchPageFromPath(pathname)
  return page ?? <LaunchSite />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GlyphProvider>
      <App />
    </GlyphProvider>
  </StrictMode>
)
