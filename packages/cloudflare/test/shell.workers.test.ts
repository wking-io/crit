import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const documentHeaders = { accept: "text/html" }

describe("Worker hosted shell", () => {
  it("serves the shell for document navigations without creating a canvas", async () => {
    const home = await SELF.fetch("https://crit.example/", {
      headers: documentHeaders
    })
    const canvas = await SELF.fetch("https://crit.example/canvas/canvas_shell", {
      headers: documentHeaders
    })
    const missing = await SELF.fetch("https://crit.example/canvas/canvas_shell", {
      headers: {
        accept: "application/json",
        "Cf-Access-Authenticated-User-Email": "ada@acme.com"
      }
    })

    expect(home.status).toBe(200)
    expect(home.headers.get("content-type")).toContain("text/html")
    expect(await home.text()).toContain("Canvases")
    expect(canvas.status).toBe(200)
    expect(await canvas.text()).toContain("Canvases")
    expect(missing.status).toBe(404)
  })

  it("leaves unknown paths missing", async () => {
    const mcp = await SELF.fetch("https://crit.example/mcp", {
      headers: documentHeaders
    })
    const oauth = await SELF.fetch("https://crit.example/oauth/authorize", {
      headers: documentHeaders
    })
    const unrelated = await SELF.fetch("https://crit.example/unrelated")

    expect(mcp.status).toBe(404)
    expect(oauth.status).toBe(404)
    expect(unrelated.status).toBe(404)
  })
})
