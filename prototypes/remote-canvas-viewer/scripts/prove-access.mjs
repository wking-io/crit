import { execSync, spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const proofDir = fileURLToPath(new URL("../proof", import.meta.url))
const canvas = "http://127.0.0.1:8797"
const app = "http://localhost:8798"
const access = "http://127.0.0.1:8799"

const waitFor = async (url) => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Timed out waiting for " + url)
}

const header = (response, name) => response.headers.get(name) ?? ""

const startOne = (name, port, inspectorPort, vars) => {
  const args = [
    "wrangler", "dev",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--inspector-port", String(inspectorPort)
  ]
  for (const [key, value] of Object.entries(vars)) {
    args.push("--var", key + ":" + value)
  }
  return spawn("npx", args, {
    cwd: `${root}/${name}`,
    stdio: ["ignore", "pipe", "pipe"]
  })
}

const ports = [8797, 8798, 8799, 19340, 19341, 19342]

const killPorts = () => {
  for (const port of ports) {
    try {
      const pids = execSync("lsof -t -iTCP:" + port + " -sTCP:LISTEN", {
        stdio: ["ignore", "pipe", "ignore"]
      }).toString().trim().split("\n").filter(Boolean)
      for (const pid of pids) {
        try { process.kill(Number(pid), "SIGKILL") } catch {}
      }
    } catch {}
  }
}

const startCluster = async ({ allowIframe, sameSite }) => {
  killPorts()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const kids = [
    startOne("canvas", 8797, 19340, { APP_ORIGIN: app, ACCESS_ORIGIN: access }),
    startOne("app", 8798, 19341, {
      CANVAS_ORIGIN: canvas,
      ACCESS_ORIGIN: access,
      ACCESS_SAMESITE: sameSite
    }),
    startOne("access", 8799, 19342, {
      APP_ORIGIN: app,
      CANVAS_ORIGIN: canvas,
      ACCESS_ALLOW_IFRAME: allowIframe ? "1" : "0"
    })
  ]
  await new Promise((resolve) => setTimeout(resolve, 500))
  const stop = () => {
    for (const child of kids) {
      try { child.kill("SIGTERM") } catch {}
    }
    killPorts()
  }
  try {
    await waitFor(canvas + "/__meta")
    await waitFor(app + "/__meta")
    await waitFor(access + "/__meta")
  } catch (error) {
    stop()
    throw error
  }
  return { stop }
}

const chromeArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--host-resolver-rules=MAP localhost 127.0.0.1"
]

const shot = async (page, name) => {
  mkdirSync(proofDir, { recursive: true })
  await page.screenshot({ path: proofDir + "/" + name })
}

const proofOf = (page) => page.evaluate(() => document.body.dataset.proof)

const frameDump = (page) => page.evaluate(() => ({
  proof: document.body.dataset.proof,
  frames: [...document.querySelectorAll("iframe")].map((frame) => frame.src)
}))

const waitProof = async (page, wanted, timeout = 10000) => {
  try {
    await page.waitForFunction(
      (values) => values.includes(document.body.dataset.proof),
      { timeout },
      wanted
    )
  } catch {}
  return proofOf(page)
}

const signInInFrame = async (page) => {
  const started = Date.now()
  while (Date.now() - started < 8000) {
    const frame = page.frames().find((item) => item.url().includes(":8799"))
    if (frame) {
      const button = await frame.$("#signin")
      if (button) {
        await button.click()
        return true
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

const puppeteer = await import("puppeteer-core")
const report = {
  question: "Does an Access-protected preview load in a Crit Frame?",
  note: "Mock of documented Access redirects, allow_iframe headers, and CF_Authorization defaults. Not a Zero Trust org.",
  sites: { canvas, app, access },
  variants: {}
}

const run = async (name, opts, exercise) => {
  const cluster = await startCluster(opts)
  const browser = await puppeteer.default.launch({
    executablePath: "/usr/local/bin/google-chrome",
    args: chromeArgs
  })
  try {
    report.variants[name] = await exercise(browser)
  } finally {
    await browser.close()
    cluster.stop()
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
}

await run("iframeOff", { allowIframe: false, sameSite: "none" }, async (browser) => {
  const checkout = await fetch(app + "/checkout", { redirect: "manual" })
  const login = await fetch(access + "/cdn-cgi/access/login?redirect_url=" + encodeURIComponent(app + "/checkout"), { redirect: "manual" })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(canvas, { waitUntil: "networkidle0" })
  const frame = await waitProof(page, ["blocked", "gate", "live"])
  await shot(page, "access-iframe-off.png")
  return {
    checkoutStatus: checkout.status,
    checkoutLocation: header(checkout, "location"),
    loginXfo: header(login, "x-frame-options"),
    loginCsp: header(login, "content-security-policy"),
    frame,
    dump: await frameDump(page)
  }
})

await run("iframeOn", { allowIframe: true, sameSite: "none" }, async (browser) => {
  const login = await fetch(access + "/cdn-cgi/access/login?redirect_url=" + encodeURIComponent(app + "/checkout"))
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(canvas, { waitUntil: "networkidle0" })
  const gate = await waitProof(page, ["gate", "blocked", "live"])
  await shot(page, "access-iframe-on-gate.png")
  const clicked = await signInInFrame(page)
  let afterSignIn = gate
  if (clicked) {
    await page.waitForFunction(() => ["live", "blocked", "gate"].includes(document.body.dataset.proof), { timeout: 8000 }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 1500))
    afterSignIn = await proofOf(page)
  }
  await shot(page, "access-iframe-signin.png")

  const top = await browser.newPage()
  await top.setViewport({ width: 1440, height: 900 })
  await top.goto(app + "/checkout", { waitUntil: "networkidle0" })
  await top.waitForSelector("#signin", { timeout: 8000 })
  await top.click("#signin")
  await top.waitForFunction(() => document.title.includes("Harbor Shop"), { timeout: 8000 })
  const canvasPage = await browser.newPage()
  await canvasPage.setViewport({ width: 1440, height: 900 })
  await canvasPage.goto(canvas, { waitUntil: "networkidle0" })
  await canvasPage.waitForFunction(() => ["live", "blocked", "gate"].includes(document.body.dataset.proof), { timeout: 8000 })
  await new Promise((resolve) => setTimeout(resolve, 800))
  await shot(canvasPage, "access-toplevel-none.png")
  return {
    loginXfo: header(login, "x-frame-options"),
    loginCsp: header(login, "content-security-policy"),
    iframeFirst: gate,
    iframeSignInClicked: clicked,
    iframeAfterSignIn: afterSignIn,
    toplevelThenCanvas: await proofOf(canvasPage),
    dump: await frameDump(canvasPage)
  }
})

await run("sameSiteLax", { allowIframe: true, sameSite: "lax" }, async (browser) => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(app + "/checkout", { waitUntil: "networkidle0" })
  await page.waitForSelector("#signin", { timeout: 8000 })
  await page.click("#signin")
  await page.waitForFunction(() => document.title.includes("Harbor Shop"), { timeout: 8000 })
  const callback = await fetch(app + "/cdn-cgi/access/callback?token=proto-access&redirect_url=" + encodeURIComponent(app + "/checkout"), { redirect: "manual" })
  const canvasPage = await browser.newPage()
  await canvasPage.setViewport({ width: 1440, height: 900 })
  await canvasPage.goto(canvas, { waitUntil: "networkidle0" })
  await canvasPage.waitForFunction(() => ["live", "blocked", "gate"].includes(document.body.dataset.proof), { timeout: 8000 })
  await new Promise((resolve) => setTimeout(resolve, 800))
  await shot(canvasPage, "access-toplevel-lax.png")
  return {
    setCookie: header(callback, "set-cookie"),
    toplevelThenCanvas: await proofOf(canvasPage)
  }
})

mkdirSync(proofDir, { recursive: true })
writeFileSync(proofDir + "/access-report.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
