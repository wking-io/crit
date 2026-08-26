import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const canvas = process.env.CANVAS_ORIGIN ?? "https://proto-remote-canvas.contact-1c8.workers.dev"
const app = process.env.APP_ORIGIN ?? "https://proto-remote-app.contact-1c8.workers.dev"
const proofDir = fileURLToPath(new URL("../proof", import.meta.url))
const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"

const header = (response, name) => response.headers.get(name) ?? ""

const checkout = await fetch(app + "/checkout", {
  redirect: "manual",
  headers: { "user-agent": ua }
})
const loginUrl = header(checkout, "location")
const login = loginUrl
  ? await fetch(loginUrl, { redirect: "manual", headers: { "user-agent": ua } })
  : null
const preflight = await fetch(app + "/checkout", {
  method: "OPTIONS",
  redirect: "manual",
  headers: {
    "user-agent": ua,
    origin: canvas,
    "access-control-request-method": "GET"
  }
})
const canvasMeta = await (await fetch(canvas + "/__meta")).json()

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
  { timeout: 15000 }
)
mkdirSync(proofDir, { recursive: true })
await page.screenshot({ path: proofDir + "/access-live-iframe-first.png" })
const iframeFirst = await page.evaluate(() => document.body.dataset.proof)
const childFrames = page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => frame.url())
let signIn = null
const accessFrame = page.frames().find((frame) => frame.url().includes("cloudflareaccess.com"))
if (accessFrame) {
  try {
    const clicked = await accessFrame.evaluate(() => {
      const button = [...document.querySelectorAll("button, a, [role=button]")].find((el) => /cloudflare|sign in/i.test(el.textContent ?? ""))
      if (!button) return false
      button.click()
      return true
    })
    await new Promise((resolve) => setTimeout(resolve, 4000))
    await page.screenshot({ path: proofDir + "/access-live-iframe-signin.png" })
    signIn = {
      clicked,
      frames: page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => {
        try {
          return { url: frame.url(), title: frame.url() }
        } catch {
          return { url: "unreadable" }
        }
      }),
      status: await page.evaluate(() => document.body.dataset.proof)
    }
  } catch (error) {
    signIn = { error: String(error) }
  }
}
await browser.close()

const report = {
  canvas,
  app,
  canvasMeta,
  checkoutStatus: checkout.status,
  checkoutLocationHost: loginUrl ? new URL(loginUrl).host : null,
  loginStatus: login?.status ?? null,
  loginXfo: login ? header(login, "x-frame-options") : null,
  loginCsp: login ? header(login, "content-security-policy") : null,
  preflightStatus: preflight.status,
  preflightAcao: header(preflight, "access-control-allow-origin"),
  preflightXfo: header(preflight, "x-frame-options"),
  iframeFirst,
  childFrames,
  signIn,
  allowIframe: Boolean(login && !header(login, "x-frame-options") && !(header(login, "content-security-policy").includes("frame-ancestors 'none'")))
}
writeFileSync(proofDir + "/access-live-report.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
