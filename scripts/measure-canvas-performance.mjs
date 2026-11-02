#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const url = process.argv[2]
const label = process.argv[3] ?? "canvas"
if (url === undefined) {
  console.error("Usage: node scripts/measure-canvas-performance.mjs <url> [label]")
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), "crit-canvas-perf-"))
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" })

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const activePortPath = join(profile, "DevToolsActivePort")
let socket

const cleanup = () => {
  socket?.close()
  chrome.kill("SIGTERM")
  rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
}

try {
  let activePort
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      activePort = readFileSync(activePortPath, "utf8").split("\n", 1)[0]
      break
    } catch {
      await delay(25)
    }
  }
  if (activePort === undefined) throw new Error("Chrome did not publish a debugging port")

  const target = await fetch(`http://127.0.0.1:${activePort}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  }).then((response) => response.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id === undefined) return
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error === undefined) waiter.resolve(message.result)
    else waiter.reject(new Error(message.error.message))
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.text)
    }
    return result.result.value
  }

  await send("Page.enable")
  await send("Runtime.enable")
  await send("Performance.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false
  })
  await send("Page.navigate", { url })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await evaluate(`document.readyState === "complete" && document.documentElement.dataset.critPerformance !== undefined`)
    if (ready) break
    if (attempt === 199) throw new Error("Canvas performance probe did not become ready")
    await delay(25)
  }
  await delay(500)

  const before = await send("Performance.getMetrics")
  const bounds = await evaluate(`(() => {
    const canvas = document.querySelector('[role="listbox"], .crit-canvas, [aria-label="Canvas actions"]')
    const rect = (canvas ?? document.documentElement).getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })()`)
  const x = Math.round(bounds.x + bounds.width * 0.72)
  const y = Math.round(bounds.y + bounds.height * 0.72)
  for (let step = 0; step < 120; step += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 4,
      deltaY: 2,
      modifiers: 0
    })
    await delay(8)
  }
  await delay(300)

  const wheel = JSON.parse(await evaluate(`document.documentElement.dataset.critPerformance`))
  const clickControl = async (name, expectedSelector) => {
    const bounds = await evaluate(`(() => {
      const controls = [...document.querySelectorAll('button, [role="button"]')]
      const control = controls.find((element) => {
        const accessible = element.getAttribute('aria-label') ?? element.textContent?.trim()
        return accessible === ${JSON.stringify(name)} || accessible?.startsWith(${JSON.stringify(name)})
      })
      if (control === undefined) return null
      const rect = control.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`)
    if (bounds === null) return { name, available: false }
    const started = Date.now()
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: bounds.x,
      y: bounds.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    })
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: bounds.x,
      y: bounds.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    })
    let visible = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      visible = await evaluate(`document.querySelector(${JSON.stringify(expectedSelector)}) !== null`)
      if (visible) break
      await delay(5)
    }
    const responseMs = Date.now() - started
    await delay(250)
    const interaction = JSON.parse(await evaluate(`document.documentElement.dataset.critPerformance`))
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" })
    await delay(50)
    return { name, available: true, visible, responseMs, interaction }
  }
  const controls = [
    await clickControl("Canvas options", '[role="menu"]'),
    await clickControl("Add frame", '[role="dialog"]'),
    await clickControl("Status:", '[role="menu"]')
  ]
  const after = await send("Performance.getMetrics")
  const page = await evaluate(`({
    title: document.title,
    frames: document.querySelectorAll('iframe').length,
    canvasItems: document.querySelectorAll('[role="option"], .crit-frame').length,
    controls: document.querySelectorAll('button, [role="button"], input, textarea').length,
    unlabeledControls: [...document.querySelectorAll('button, [role="button"], input, textarea')].filter((element) => {
      const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent
      return label === null || label.trim() === ''
    }).length,
    bodyText: document.body.innerText.slice(0, 120)
  })`)
  const metrics = (result) => Object.fromEntries(
    result.metrics.map((metric) => [metric.name, metric.value])
  )
  const first = metrics(before)
  const last = metrics(after)
  const delta = Object.fromEntries([
    "TaskDuration",
    "ScriptDuration",
    "LayoutDuration",
    "RecalcStyleDuration",
    "LayoutCount",
    "RecalcStyleCount",
    "JSHeapUsedSize"
  ].map((name) => [name, (last[name] ?? 0) - (first[name] ?? 0)]))

  console.log(JSON.stringify({ label, url, page, wheel, controls, browser: delta }, null, 2))
} finally {
  cleanup()
}
