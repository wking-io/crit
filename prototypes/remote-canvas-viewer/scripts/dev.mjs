import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

const start = (name, port) => {
  const child = spawn("npx", ["wrangler",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port)
  ], {
    cwd: `${root}/${name}`,
    stdio: "inherit"
  })
  child.on("exit", (code) => {
    if (code) process.exit(code ?? 1)
  })
}

start("canvas", 8787)
start("app", 8788)

console.log("Canvas host  http://127.0.0.1:8787")
console.log("App preview  http://127.0.0.1:8788/checkout")
