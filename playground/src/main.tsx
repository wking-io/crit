import { Profiler, StrictMode, Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"
import {
  installCanvasPerformanceProbe,
  recordCanvasReactCommit
} from "../../packages/react/src/canvas-performance-probe.js"
import { GlyphProvider } from "../../src/react/glyph.js"
import { FramePage, frameRouteUrl, frameVariantFromUrl } from "./frame-page.js"
import "./styles.css"

const UiLab = lazy(() => import("./ui-lab.js"))
const PrototypeArchivePage = lazy(() => import("./prototype-archive-page.js"))

function App() {
  const routeUrl = frameRouteUrl()
  const pathname = new URL(routeUrl, window.location.href).pathname
  if (pathname.replace(/\/+$/, "").startsWith("/ui/prototypes")) {
    return <Suspense fallback={<main className="ui-lab-loading">Opening prototype archive…</main>}><PrototypeArchivePage /></Suspense>
  }
  if (pathname.replace(/\/+$/, "") === "/ui") {
    return <Suspense fallback={<main className="ui-lab-loading">Opening UI lab…</main>}><UiLab /></Suspense>
  }
  const variant = frameVariantFromUrl(routeUrl)
  return variant === undefined ? null : <FramePage variant={variant} />
}

installCanvasPerformanceProbe()
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Profiler id="crit-alpha" onRender={(_id, _phase, duration) => {
      recordCanvasReactCommit(duration)
    }}>
      <GlyphProvider><App /></GlyphProvider>
    </Profiler>
  </StrictMode>
)
