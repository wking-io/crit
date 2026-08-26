import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const canvas = "http://127.0.0.1:8787"
const app = "http://127.0.0.1:8788"
const proofDir = fileURLToPath(new URL("../proof", import.meta.url))

const waitFor = async (url) => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Timed out waiting for " + url)
}

const header = (response, name) => response.headers.get(name) ?? ""

await waitFor(canvas + "/__meta")
await waitFor(app + "/__meta")

const canvasMeta = await (await fetch(canvas + "/__meta")).json()
const appMeta = await (await fetch(app + "/__meta")).json()
const checkout = await fetch(app + "/checkout")
const locked = await fetch(app + "/locked")

if (canvasMeta.origin === appMeta.origin) {
  throw new Error("Canvas and app share an origin")
}

const checkoutCsp = header(checkout, "content-security-policy")
const lockedCsp = header(locked, "content-security-policy")
if (!checkoutCsp.includes("frame-ancestors " + canvas)) {
  throw new Error("Checkout is missing canvas frame-ancestors")
}
if (!lockedCsp.includes("frame-ancestors 'none'") || header(locked, "x-frame-options") !== "DENY") {
  throw new Error("Locked route is still frameable")
}

const puppeteer = await import("puppeteer-core")
const browser = await puppeteer.default.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.goto(canvas, { waitUntil: "networkidle0" })
await page.waitForFunction(() => document.body.dataset.proof === "live", { timeout: 8000 })
mkdirSync(proofDir, { recursive: true })
await page.screenshot({ path: proofDir + "/live.png" })
await page.click('[data-route="locked"]')
await page.waitForFunction(() => document.body.dataset.proof === "blocked", { timeout: 8000 })
await page.screenshot({ path: proofDir + "/blocked.png" })
const proof = await page.evaluate(() => document.body.dataset.proof)
await browser.close()

const report = {
  canvas: canvasMeta,
  app: appMeta,
  sameOrigin: canvasMeta.origin === appMeta.origin,
  checkoutCsp,
  lockedCsp,
  iframe: proof
}
writeFileSync(proofDir + "/report.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
