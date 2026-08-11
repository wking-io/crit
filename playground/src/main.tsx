import {
  StrictMode,
  Suspense,
  lazy,
  useMemo,
  useState,
  type CSSProperties
} from "react"
import { createRoot } from "react-dom/client"
import { Glyph, GlyphProvider } from "../../src/react/glyph.js"

import "./styles.css"

const UiLab = lazy(() => import("./ui-lab.js"))

export const frameRouteUrl = () =>
  document.querySelector<HTMLMetaElement>('meta[name="crit-frame-url"]')?.content ??
  window.location.href

type FrameVariant = "draft" | "ready" | "approved" | "changes"

const variants: Record<FrameVariant, {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly accent: string
}> = {
  draft: {
    eyebrow: "Iteration 01 · Draft",
    title: "Complete your order",
    description: "An intentionally rough pass with live controls for iframe interaction testing.",
    accent: "#f59e0b"
  },
  ready: {
    eyebrow: "Iteration 02 · Candidate",
    title: "Everything looks good",
    description: "A polished candidate that is ready for a person to review.",
    accent: "#7c3aed"
  },
  approved: {
    eyebrow: "Iteration 03 · Approved",
    title: "Order confirmed",
    description: "A settled direction with a compact confirmation experience.",
    accent: "#16a34a"
  },
  changes: {
    eyebrow: "Iteration 04 · Feedback",
    title: "Review your cart",
    description: "A candidate with visible issues that should receive requested changes.",
    accent: "#dc2626"
  }
}

function QuantityControl() {
  const [quantity, setQuantity] = useState(1)
  return (
    <div className="quantity" aria-label="Quantity">
      <button aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))} type="button"><Glyph name="minus" /></button>
      <output>{quantity}</output>
      <button aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)} type="button"><Glyph name="plus" /></button>
    </div>
  )
}

function FramePage({ variant }: { readonly variant: FrameVariant }) {
  const content = variants[variant]
  const [email, setEmail] = useState("alex@example.com")
  const [submitted, setSubmitted] = useState(false)
  const price = useMemo(() => variant === "draft" ? "$128.00" : "$118.00", [variant])

  return (
    <main className={`frame-page frame-${variant}`} style={{ "--accent": content.accent } as CSSProperties}>
      <nav className="store-nav">
        <span className="store-mark" aria-label="Riff Supply">R/R</span>
        <span>Riff Supply</span>
        <button type="button">Bag · 1</button>
      </nav>

      <section className="checkout-shell">
        <div className="checkout-copy">
          <p className="frame-eyebrow">{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p>{content.description}</p>

          {variant === "approved" ? (
            <div className="confirmation-card">
              <span className="confirmation-icon"><Glyph name="success" /></span>
              <div>
                <strong>Thanks, Alex.</strong>
                <p>Confirmation RR-2048 is headed to your inbox.</p>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                setSubmitted(true)
              }}
            >
              <label>
                Email address
                <input onChange={(event) => setEmail(event.currentTarget.value)} value={email} />
              </label>
              <label>
                Delivery
                <select defaultValue="standard">
                  <option value="standard">Standard · Free</option>
                  <option value="express">Express · $12</option>
                </select>
              </label>
              <button className="primary-action" type="submit">
                {submitted ? "Saved for review" : variant === "changes" ? "Continue anyway" : "Continue to payment"}
              </button>
              {submitted ? <p className="success-message" role="status">Interactive Frame controls work.</p> : null}
            </form>
          )}
        </div>

        <aside className="order-card">
          <div className="product-image"><span>FIELD<br />NOTES</span></div>
          <div className="product-row">
            <div>
              <strong>Field Notes No. 04</strong>
              <p>Warm grey · Recycled stock</p>
            </div>
            <QuantityControl />
          </div>
          <dl>
            <div><dt>Subtotal</dt><dd>{price}</dd></div>
            <div><dt>Shipping</dt><dd>Free</dd></div>
            <div className="total"><dt>Total</dt><dd>{price}</dd></div>
          </dl>
          {variant === "changes" ? (
            <div className="review-callout">
              <strong>Review prompt</strong>
              <p>The hierarchy and primary action need another pass.</p>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  )
}

function App() {
  const pathname = new URL(frameRouteUrl(), window.location.href).pathname
  if (pathname.replace(/\/+$/, "") === "/ui") {
    return (
      <Suspense fallback={<main className="ui-lab-loading">Opening UI lab…</main>}>
        <UiLab />
      </Suspense>
    )
  }
  const match = pathname.match(/^\/frames\/(draft|ready|approved|changes)\/?$/)
  return match === null ? null : <FramePage variant={match[1] as FrameVariant} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GlyphProvider><App /></GlyphProvider>
  </StrictMode>
)
