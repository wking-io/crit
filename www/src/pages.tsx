import { useState, type ReactNode } from "react"

import type { GlyphName } from "@riff-refine/crit"
import {
  Accordion,
  actionHelpDetails,
  Button,
  CanvasControls,
  CanvasHelpPanel,
  CanvasPresenceIndicator,
  CanvasSaveIndicator,
  Checkbox,
  CritOverlayProvider,
  critStyles,
  Field,
  Form,
  FRAME_STATUSES,
  Glyph,
  Input,
  Separator,
  Toast,
  Tooltip
} from "@riff-refine/crit"

import { INSTALL_COMMAND } from "./layout.js"

import "@riff-refine/crit/tokens.css"
import "./pages.css"

const copyText = async (value: string) => {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard !== undefined) {
    await clipboard.writeText(value)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.readOnly = true
  document.body.append(textarea)
  textarea.select()
  document.execCommand("copy")
  textarea.remove()
}

function LaunchToasts() {
  const { toasts } = Toast.useToastManager()
  return (
    <Toast.Viewport className="launch-toast-viewport">
      {toasts.map((toast) => (
        <Toast.Root className="launch-toast" key={toast.id} toast={toast}>
          <Toast.Description />
        </Toast.Root>
      ))}
    </Toast.Viewport>
  )
}

function LaunchPage({
  children,
  className
}: {
  readonly children: ReactNode
  readonly className: string
}) {
  return (
    <CritOverlayProvider>
      <style data-crit-ui-styles="">{critStyles}</style>
      <main className={`launch-page ${className}`}>{children}</main>
    </CritOverlayProvider>
  )
}

export function LaunchHeroPage() {
  return (
    <Toast.Provider timeout={1400}>
      <Tooltip.Provider delay={200}>
        <LaunchHeroContent />
      </Tooltip.Provider>
    </Toast.Provider>
  )
}

function LaunchHeroContent() {
  const toast = Toast.useToastManager()
  const [copied, setCopied] = useState(false)
  const copyInstall = (anchor: HTMLElement) => {
    void copyText(INSTALL_COMMAND).then(() => {
      setCopied(true)
      toast.add({
        description: "Install command copied",
        id: "launch-install-copy"
      })
      window.setTimeout(() => setCopied(false), 1600)
      anchor.blur()
    }).catch(() => undefined)
  }

  return (
    <LaunchPage className="launch-hero">
      <p className="launch-kicker">Crit</p>
      <h1>Using AI shouldn&apos;t mean you have to work like a dev</h1>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              className="launch-install"
              data-primary=""
              onClick={(event) => copyInstall(event.currentTarget)}
              type="button"
            />
          }
        >
          {copied ? "Copied" : "Install with your agent"}
          <Glyph aria-hidden name="copy" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup className="launch-tooltip">
              Copies <code>{INSTALL_COMMAND}</code>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <LaunchToasts />
    </LaunchPage>
  )
}

const FEATURES: ReadonlyArray<{
  readonly id: string
  readonly title: string
  readonly glyph: GlyphName
  readonly body: string
}> = [
  {
    id: "frames",
    title: "Live Frames from any URL",
    glyph: "addFrame",
    body: "Pin the actual page on an infinite canvas. Identity stays stable when the URL changes."
  },
  {
    id: "canvas",
    title: "An infinite canvas, not a board of screenshots",
    glyph: "pan",
    body: "Pan, zoom, and arrange live iterations the way a designer already thinks."
  },
  {
    id: "notes",
    title: "Notes that sit on the work",
    glyph: "note",
    body: "Plain-text feedback with a readable line measure, attached to a Frame or free on the canvas."
  },
  {
    id: "status",
    title: "Review statuses",
    glyph: "statusReadyForReview",
    body: "In progress, ready for review, approved, and changes requested — without a separate tracker."
  },
  {
    id: "snapshots",
    title: "Immutable snapshots",
    glyph: "snapshot",
    body: "Preserve a version beside the live Frame so the next agent pass cannot erase the last good one."
  },
  {
    id: "comments",
    title: "Comments on the live page",
    glyph: "comment",
    body: "Pin a thread to a Frame or to an element inside it. The opening Author owns the conversation."
  },
  {
    id: "agents",
    title: "Built for agents",
    glyph: "layers",
    body: "The same canvas files agents edit from the CLI. No collaboration server to configure."
  },
  {
    id: "local",
    title: "Local-first",
    glyph: "save",
    body: "The Canvas Document lives on disk. Browser windows and agents share one lock, not a cloud room."
  }
]

const FEATURE_HELP = CanvasControls.resolve({
  platform: "macos",
  activeScopes: ["canvas"],
  globalFacts: { commentAuthorPresent: true },
  pendingActions: []
})

export function LaunchFeaturesPage() {
  return (
    <LaunchPage className="launch-features">
      <p className="launch-kicker">The surface</p>
      <h1>Everything stays on one canvas</h1>
      <p className="launch-lede">
        Crit is the review environment, not a new place to file tickets. These
        are the same components the editor uses, so when they change, this page
        changes with them.
      </p>
      <Accordion.Root className="launch-accordion" defaultValue={["frames"]}>
        {FEATURES.map((feature) => (
          <Accordion.Item
            className="launch-accordion__item"
            key={feature.id}
            value={feature.id}
          >
            <Accordion.Header>
              <Accordion.Trigger className="launch-accordion__trigger">
                <Glyph name={feature.glyph} />
                <span>{feature.title}</span>
                <Glyph name="chevronRight" />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="launch-accordion__panel">
              {feature.body}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion.Root>
      <Separator className="launch-separator" />
      <section className="launch-status-row" aria-label="Review statuses">
        {FRAME_STATUSES.map((status) => (
          <span className="launch-status" key={status.id}>
            <Glyph name={status.glyph} />
            {status.label}
          </span>
        ))}
      </section>
      <div className="launch-surface-grid">
        <CanvasHelpPanel
          details={actionHelpDetails(FEATURE_HELP.action({ id: "open-new-frame" }))}
        />
        <CanvasPresenceIndicator
          presence={{
            currentAuthor: { id: "signed-in:ada@example.com", name: "Ada Lovelace" },
            availability: "available",
            activities: []
          }}
        />
        <CanvasSaveIndicator
          onDiscardLocalChanges={() => {}}
          recoveryStatus="available"
          saveStatus="clean"
        />
      </div>
    </LaunchPage>
  )
}

export function LaunchSignupPage() {
  return (
    <Toast.Provider timeout={1600}>
      <LaunchSignupContent />
    </Toast.Provider>
  )
}

function LaunchSignupContent() {
  const toast = Toast.useToastManager()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})

  const submit = () => {
    const nextErrors: Record<string, string> = {}
    if (!email.trim().includes("@")) nextErrors.email = "Enter an email address."
    if (!consent) nextErrors.consent = "Agree to receive occasional updates."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    toast.add({
      description: "You are on the list.",
      id: "launch-signup"
    })
    setEmail("")
    setName("")
    setConsent(false)
  }

  return (
    <LaunchPage className="launch-signup">
      <p className="launch-kicker">Stay close</p>
      <h1>Get email updates</h1>
      <p className="launch-lede">
        New install paths, canvas behavior, and agent workflow — written for
        designers working with agents, not for changelog archaeologists.
      </p>
      <Form
        className="launch-form"
        errors={errors}
        onFormSubmit={submit}
      >
        <Field.Root name="name">
          <Field.Label>Name <span>(optional)</span></Field.Label>
          <Input
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Ada Lovelace"
            value={name}
          />
        </Field.Root>
        <Field.Root name="email">
          <Field.Label>Email</Field.Label>
          <Input
            onChange={(event) => setEmail(event.currentTarget.value)}
            placeholder="ada@example.com"
            required
            type="email"
            value={email}
          />
          <Field.Error />
        </Field.Root>
        <Field.Root name="consent">
          <label className="launch-consent">
            <Checkbox.Root
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            >
              <Checkbox.Indicator>
                <Glyph name="success" />
              </Checkbox.Indicator>
            </Checkbox.Root>
            Send me occasional Crit updates.
          </label>
          <Field.Error />
        </Field.Root>
        <Button data-primary="" type="submit">
          Subscribe
        </Button>
      </Form>
      <LaunchToasts />
    </LaunchPage>
  )
}

export const launchPageFromPath = (pathname: string) => {
  const path = pathname.replace(/\/+$/, "")
  if (path === "/hero") return <LaunchHeroPage />
  if (path === "/features") return <LaunchFeaturesPage />
  if (path === "/signup") return <LaunchSignupPage />
  return undefined
}
