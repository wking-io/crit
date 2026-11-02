#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import sharp from "sharp"

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const outputDirectory = resolve(process.argv[2] ?? `.artifacts/context-menu/${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`)
const targets = [
  { label: "alpha", url: "http://127.0.0.1:5174/?profile=alpha", trigger: "[aria-label^='Actions for']" },
  { label: "v1", url: "http://127.0.0.1:5173/canvas/canvas_performance_lab_v2", trigger: "[role='option']" }
]
mkdirSync(outputDirectory, { recursive: true })
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const capture = async({ label, url, trigger }) => {
  const profile = mkdtempSync(join(tmpdir(), `crit-menu-${label}-`))
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--force-device-scale-factor=1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore" })
  let socket
  try {
    const portFile = join(profile, "DevToolsActivePort")
    let port
    for (let attempt = 0; attempt < 600; attempt += 1) {
      try {
        port = readFileSync(portFile, "utf8").split("\n", 1)[0]
        break
      } catch {
        await delay(25)
      }
    }
    if (port === undefined) throw new Error(`${label}: Chrome debugging port missing`)
    const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then((response) => response.json())
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener("open", resolveOpen, { once: true })
      socket.addEventListener("error", reject, { once: true })
    })
    let id = 0
    const pending = new Map()
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data))
      const waiter = pending.get(message.id)
      if (waiter === undefined) return
      pending.delete(message.id)
      message.error === undefined ? waiter.resolve(message.result) : waiter.reject(new Error(message.error.message))
    })
    const send = (method, params = {}) => new Promise((resolveSend, reject) => {
      const requestId = ++id
      pending.set(requestId, { resolve: resolveSend, reject })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async(expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails !== undefined) throw new Error(`${label}: ${result.exceptionDetails.text}`)
      return result.result.value
    }
    await send("Page.enable")
    await send("Runtime.enable")
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false })
    await send("Page.navigate", { url })
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await evaluate(`document.readyState === "complete" && document.querySelector(${JSON.stringify(trigger)}) !== null`)) break
      if (attempt === 599) throw new Error(`${label}: frame action region missing`)
      await delay(25)
    }
    await delay(500)
    await evaluate(`document.querySelector(${JSON.stringify(trigger)}).focus()`)
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "F10", code: "F10", modifiers: 8 })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "F10", code: "F10", modifiers: 8 })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(`document.querySelector('.crit-context-menu') !== null`)) break
      if (attempt === 99) throw new Error(`${label}: context menu did not open`)
      await delay(10)
    }
    await delay(200)
    const evidence = await evaluate(`(() => {
      const menu = document.querySelector('.crit-context-menu')
      const rect = menu.getBoundingClientRect()
      const style = getComputedStyle(menu)
      const items = [...menu.querySelectorAll('.crit-context-menu__item')].map((item) => {
        const itemRect = item.getBoundingClientRect()
        const itemStyle = getComputedStyle(item)
        return { text: item.textContent.trim(), x: itemRect.x - rect.x, y: itemRect.y - rect.y, width: itemRect.width, height: itemRect.height, color: itemStyle.color, background: itemStyle.backgroundColor, font: itemStyle.font, padding: itemStyle.padding, gap: itemStyle.gap }
      })
      return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, style: { background: style.backgroundColor, border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow, color: style.color, font: style.font, padding: style.padding }, items }
    })()`)
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x: evidence.rect.x, y: evidence.rect.y, width: evidence.rect.width, height: evidence.rect.height, scale: 1 }
    })
    const screenshotPath = resolve(outputDirectory, `${label}.png`)
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"))
    writeFileSync(resolve(outputDirectory, `${label}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
    return { ...evidence, screenshotPath }
  } finally {
    socket?.close()
    chrome.kill("SIGTERM")
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
}

const alpha = await capture(targets[0])
const v1 = await capture(targets[1])
const alphaMetadata = await sharp(alpha.screenshotPath).metadata()
const v1Metadata = await sharp(v1.screenshotPath).metadata()
const width = Math.max(alphaMetadata.width, v1Metadata.width)
const height = Math.max(alphaMetadata.height, v1Metadata.height)
const raw = async(path) => {
  const image = sharp(path)
  const metadata = await image.metadata()
  return image.extend({
    right: width - metadata.width,
    bottom: height - metadata.height,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  }).ensureAlpha().raw().toBuffer()
}
const [alphaPixels, v1Pixels] = await Promise.all([raw(alpha.screenshotPath), raw(v1.screenshotPath)])
const diffPixels = Buffer.alloc(alphaPixels.length)
let changedPixels = 0
let absoluteDifference = 0
for (let index = 0; index < alphaPixels.length; index += 4) {
  let changed = false
  for (let channel = 0; channel < 4; channel += 1) {
    const difference = Math.abs(alphaPixels[index + channel] - v1Pixels[index + channel])
    absoluteDifference += difference
    diffPixels[index + channel] = channel === 3 ? 255 : Math.min(255, difference * 4)
    if (difference !== 0) changed = true
  }
  if (changed) changedPixels += 1
}
await sharp(diffPixels, { raw: { width, height, channels: 4 } }).png().toFile(resolve(outputDirectory, "diff.png"))
const exactStyleMatch = JSON.stringify(alpha.style) === JSON.stringify(v1.style)
const exactItemGeometryMatch = JSON.stringify(alpha.items) === JSON.stringify(v1.items)
const summary = {
  outputDirectory,
  verdict: changedPixels === 0 && exactStyleMatch && exactItemGeometryMatch ? "identical" : "different",
  dimensions: { alpha: alpha.rect, v1: v1.rect },
  changedPixels,
  totalPixels: width * height,
  changedPixelRatio: changedPixels / (width * height),
  meanAbsoluteChannelDifference: absoluteDifference / alphaPixels.length,
  exactStyleMatch,
  exactItemGeometryMatch,
  alphaItems: alpha.items.map(({ text }) => text),
  v1Items: v1.items.map(({ text }) => text)
}
writeFileSync(resolve(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
