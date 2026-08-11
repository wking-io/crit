import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { GlyphProvider } from "../../src/react/glyph.js"
import { FramePage, frameRouteUrl, frameVariantFromUrl } from "./frame-page.js"
import "./styles.css"

const variant = frameVariantFromUrl(frameRouteUrl())
if (variant !== undefined) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode><GlyphProvider><FramePage variant={variant} /></GlyphProvider></StrictMode>
  )
}
