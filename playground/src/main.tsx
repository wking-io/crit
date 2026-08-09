import { StrictMode, useMemo, useState, type CSSProperties } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"

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

const featureGroups = [
  {
    title: "Canvas",
    items: ["Infinite pan and zoom", "Right-click creation menu", "Stable Frame toolbars", "Offscreen iframe pausing"]
  },
  {
    title: "Frames",
    items: ["Drag and resize", "Full document-height fit", "Right-click actions", "Live iframe interaction"]
  },
  {
    title: "Review",
    items: ["Editable Notes", "Attach and detach Notes", "Autosave and recovery", "Immutable snapshots"]
  },
  {
    title: "Coordination",
    items: ["Agent CLI edits", "Activity indicator", "Multiple browser windows", "Manifest discovery"]
  }
] as const

const agentCommands = [
  "npm run dev:agent -- open feature-lab --json",
  "npm run dev:agent -- activity feature-lab --for 120 --detail \"Testing agent edits\" --json",
  "npm run dev:agent -- apply feature-lab '[{\"_tag\":\"SetFrameStatus\",\"id\":\"checkout-draft\",\"status\":\"ready-for-review\"}]' --json",
  "npm run dev:agent -- snapshot feature-lab checkout-ready --json",
  "npm run dev:agent -- activity feature-lab --clear --json"
] as const

function CopyCommand({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="command"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_200)
        })
      }}
      type="button"
    >
      <code>{command}</code>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  )
}

function LabHome() {
  return (
    <main className="lab-shell">
      <header className="lab-hero">
        <div>
          <p className="brand">CRIT / FEATURE LAB</p>
          <h1>Test the whole local review loop.</h1>
          <p className="lede">
            One real Vite app, four live iterations, a filesystem-backed Canvas,
            and the same commands local agents use.
          </p>
        </div>
        <a className="open-canvas" href="/crit/feature-lab">
          Open feature Canvas <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section aria-labelledby="coverage-title" className="lab-section">
        <div className="section-heading">
          <div>
            <p className="kicker">Browser coverage</p>
            <h2 id="coverage-title">A deliberate surface for every V1 behavior</h2>
          </div>
          <p>Open the Canvas in two windows to test local synchronization.</p>
        </div>
        <div className="feature-grid">
          {featureGroups.map((group, index) => (
            <article className="feature-card" key={group.title}>
              <span className="feature-number">0{index + 1}</span>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="agent-title" className="lab-section agent-section">
        <div className="section-heading">
          <div>
            <p className="kicker">Agent coverage</p>
            <h2 id="agent-title">Edit the open Canvas from another terminal</h2>
          </div>
          <p>Run from the Crit repository while <code>npm run dev:portless</code> remains active.</p>
        </div>
        <div className="command-list">
          {agentCommands.map((command) => <CopyCommand command={command} key={command} />)}
        </div>
      </section>

      <footer className="lab-footer">
        <span>Data persists in <code>playground/.crit</code></span>
        <a href="/.well-known/crit.json">Inspect discovery manifest</a>
      </footer>
    </main>
  )
}

function QuantityControl() {
  const [quantity, setQuantity] = useState(1)
  return (
    <div className="quantity" aria-label="Quantity">
      <button onClick={() => setQuantity(Math.max(1, quantity - 1))} type="button">−</button>
      <output>{quantity}</output>
      <button onClick={() => setQuantity(quantity + 1)} type="button">+</button>
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
        <a href="/" className="store-mark" aria-label="Back to feature lab">R/R</a>
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
              <span className="confirmation-icon">✓</span>
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
  const match = window.location.pathname.match(/^\/frames\/(draft|ready|approved|changes)\/?$/)
  return match === null ? <LabHome /> : <FramePage variant={match[1] as FrameVariant} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
