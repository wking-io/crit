import { execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const portless = fileURLToPath(new URL("../node_modules/portless/dist/cli.js", import.meta.url))
const environment = {
  ...process.env,
  PORTLESS_LAN: "0",
  PORTLESS_TLD: "localhost",
  PORTLESS_HTTPS: "1"
}
const run = (args, stdio = "inherit") => execFileSync(process.execPath, [portless, ...args], {
  cwd: root,
  env: environment,
  encoding: "utf8",
  stdio
})

run(["proxy", "start"])
const frameOrigin = run(["get", "crit-frames"], "pipe").trim()
const commands = [
  ["run", "--name", "crit-frames", "vite", "--config", "playground/vite.config.ts"],
  ["run", "--name", "crit", "node", "packages/cli/dist/main.js", "dev", "--application-origin", `${frameOrigin}/`]
]
const children = commands.map((args) => spawn(process.execPath, [portless, ...args], {
  cwd: root,
  env: environment,
  stdio: "inherit",
  detached: true
}))
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) continue
    try {
      process.kill(-child.pid, "SIGINT")
    } catch (cause) {
      if (cause.code !== "ESRCH") throw cause
    }
  }
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
await Promise.all(children.map((child) => new Promise((resolve) => {
  child.once("error", (cause) => {
    console.error(cause.message)
    process.exitCode = 1
    stop()
    resolve()
  })
  child.once("exit", (code) => {
    if (!stopping) process.exitCode = code ?? 1
    stop()
    resolve()
  })
})))
