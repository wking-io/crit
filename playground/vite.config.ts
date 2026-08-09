import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

import { crit } from "../src/vite/index.js"

const port = Number.parseInt(
  process.env.PORT ?? process.env.CRIT_PLAYGROUND_PORT ?? "5173",
  10
)

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    {
      name: "crit-feature-lab-home",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(
            request.url ?? "/",
            "http://crit.localhost"
          )
          if (request.method !== "GET" || url.pathname !== "/") {
            next()
            return
          }
          request.url = `/crit/feature-lab${url.search}`
          next()
        })
      }
    },
    crit({
      title: (canvasId) =>
        canvasId === "feature-lab" ? "Crit feature lab" : canvasId
    })
  ],
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port,
    strictPort: true
  }
})
