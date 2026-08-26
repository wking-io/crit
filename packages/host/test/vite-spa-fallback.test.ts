/** @vitest-environment node */
import type { AddressInfo } from "node:net"
import { createServer } from "vite"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const hostRoot = fileURLToPath(new URL("..", import.meta.url))

const listenPort = (address: string | AddressInfo | null | undefined): number => {
  if (address !== null && address !== undefined && "port" in address) return address.port
  throw new Error("expected a TCP listen address")
}

describe("host Vite SPA fallback", () => {
  let server: Awaited<ReturnType<typeof createServer>> | undefined

  afterEach(async() => {
    if (server === undefined) return
    await server.close()
    server = undefined
  })

  it("serves the host document for a canvas path", async() => {
    server = await createServer({
      configFile: path.join(hostRoot, "vite.config.ts"),
      root: hostRoot,
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false
      }
    })
    await server.listen()
    const page = await fetch(`http://127.0.0.1:${listenPort(server.httpServer?.address())}/canvas/canvas_shop`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("id=\"root\"")
  })
})
