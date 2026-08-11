import { StrictMode, Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"
import { GlyphProvider } from "../../src/react/glyph.js"
import { FramePage, frameRouteUrl, frameVariantFromUrl } from "./frame-page.js"
import "./styles.css"

const UiLab = lazy(() => import("./ui-lab.js"))

function App() {
  const routeUrl = frameRouteUrl()
  const pathname = new URL(routeUrl, window.location.href).pathname
  if (pathname.replace(/\/+$/, "") === "/ui") {
    return <Suspense fallback={<main className="ui-lab-loading">Opening UI lab…</main>}><UiLab /></Suspense>
  }
  const variant = frameVariantFromUrl(routeUrl)
  return variant === undefined ? null : <FramePage variant={variant} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><GlyphProvider><App /></GlyphProvider></StrictMode>
)
