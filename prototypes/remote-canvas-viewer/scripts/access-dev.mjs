import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const canvas = "http://127.0.0.1:8797"
const app = "http://localhost:8798"
const access = "http://127.0.0.1:8799"
const allowIframe = process.env.ACCESS_ALLOW_IFRAME ?? "1"
const sameSite = process.env.ACCESS_SAMESITE ?? "none"

const start = (name, port, inspectorPort, vars) => {
  const args = [
    "wrangler", "dev",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--inspector-port", String(inspectorPort)
  ]
  for (const [key, value] of Object.entries(vars)) {
    args.push("--var", key + ":" + value)
  }
  const child = spawn("npx", args, {
    cwd: `${root}/${name}`,
    stdio: "inherit"
  })
  child.on("exit", (code) => {
    if (code) process.exit(code ?? 1)
  })
  return child
}

start("canvas", 8797, 19340, {
  APP_ORIGIN: app,
  ACCESS_ORIGIN: access
})
start("app", 8798, 19341, {
  CANVAS_ORIGIN: canvas,
  ACCESS_ORIGIN: access,
  ACCESS_SAMESITE: sameSite
})
start("access", 8799, 19342, {
  APP_ORIGIN: app,
  CANVAS_ORIGIN: canvas,
  ACCESS_ALLOW_IFRAME: allowIframe
})

console.log("Canvas host  " + canvas)
console.log("App preview  " + app + "/checkout")
console.log("Access gate  " + access)
console.log("allow_iframe " + (allowIframe === "0" ? "off" : "on"))
console.log("SameSite     " + sameSite)
