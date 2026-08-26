import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const canvas = process.env.CANVAS_ORIGIN ?? "https://proto-remote-canvas.contact-1c8.workers.dev"
const app = process.env.APP_ORIGIN ?? "https://proto-remote-app.contact-1c8.workers.dev"
const proofDir = fileURLToPath(new URL("../proof", import.meta.url))

const header = (response, name) => response.headers.get(name) ?? ""

const checkout = await fetch(app + "/checkout", { redirect: "manual" })
const locked = await fetch(app + "/locked", { redirect: "manual" })
const canvasMeta = await (await fetch(canvas + "/__meta")).json()
const appMeta = await (await fetch(app + "/__meta")).json()

const puppeteer = await import("puppeteer-core")
const browser = await puppeteer.default.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.goto(canvas, { waitUntil: "networkidle0", timeout: 30000 })
await page.waitForFunction(
  () => ["live", "blocked", "gate"].includes(document.body.dataset.proof),
  { timeout: 12000 }
)
mkdirSync(proofDir, { recursive: true })
await page.screenshot({ path: proofDir + "/live-cloudflare.png" })
const first = await page.evaluate(() => document.body.dataset.proof)
await page.click('[data-route="locked"]')
await page.waitForFunction(
  () => ["live", "blocked", "gate"].includes(document.body.dataset.proof),
  { timeout: 12000 }
)
await page.screenshot({ path: proofDir + "/locked-cloudflare.png" })
const lockedProof = await page.evaluate(() => document.body.dataset.proof)
await browser.close()

const report = {
  canvas,
  app,
  canvasMeta,
  appMeta,
  checkoutStatus: checkout.status,
  checkoutLocation: header(checkout, "location"),
  checkoutCsp: header(checkout, "content-security-policy"),
  checkoutXfo: header(checkout, "x-frame-options"),
  lockedStatus: locked.status,
  lockedCsp: header(locked, "content-security-policy"),
  lockedXfo: header(locked, "x-frame-options"),
  iframeCheckout: first,
  iframeLocked: lockedProof
}
writeFileSync(proofDir + "/live-cloudflare-report.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
