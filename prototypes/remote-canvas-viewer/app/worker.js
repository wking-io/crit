const pages = {
  "/": {
    title: "Harbor Shop",
    kicker: "Home",
    copy: "A live storefront on its own Cloudflare origin."
  },
  "/checkout": {
    title: "Checkout",
    kicker: "Pay",
    copy: "This page is an application route. The canvas host did not serve it."
  },
  "/account": {
    title: "Account",
    kicker: "You",
    copy: "Another application route on the same preview origin."
  },
  "/locked": {
    title: "Locked preview",
    kicker: "Blocked",
    copy: "This route sends X-Frame-Options DENY so the canvas must stay blank."
  }
}

const html = ({ origin, route, page }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${page.title} · Harbor Shop</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font: 16px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: #f4efe6;
      color: #1d1914;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 18px 22px;
      background: #1f3d32;
      color: #f4efe6;
    }
    header strong { font-size: 18px; }
    header span { opacity: 0.75; font-size: 13px; }
    main { padding: 28px 22px 40px; max-width: 640px; }
    .kicker { color: #6b4f2a; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 4px 0 8px; font-size: 36px; }
    .meta {
      display: grid;
      gap: 8px;
      margin: 20px 0;
    }
    .meta div {
      background: #fff;
      border: 1px solid #ddd4c4;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .meta b { display: block; font-size: 11px; color: #7a6d5b; text-transform: uppercase; letter-spacing: 0.04em; }
    button {
      appearance: none;
      border: 0;
      background: #1f3d32;
      color: #f4efe6;
      border-radius: 999px;
      padding: 10px 14px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <header>
    <strong>Harbor Shop</strong>
    <span id="clock"></span>
  </header>
  <main>
    <div class="kicker">${page.kicker}</div>
    <h1>${page.title}</h1>
    <p>${page.copy}</p>
    <div class="meta">
      <div><b>App origin</b><code>${origin}</code></div>
      <div><b>Application route</b><code>${route}</code></div>
      <div><b>Cart</b><span id="cart">1 item</span></div>
    </div>
    <button type="button" id="add">Add a mug</button>
  </main>
  <script>
    const payload = {
      source: "proto-remote-app",
      origin: ${JSON.stringify(origin)},
      pathname: ${JSON.stringify(route)},
      loadedAt: new Date().toISOString()
    }
    const tick = () => {
      document.getElementById("clock").textContent = new Date().toLocaleTimeString()
    }
    tick()
    setInterval(tick, 1000)
    let items = 1
    document.getElementById("add").addEventListener("click", () => {
      items += 1
      document.getElementById("cart").textContent = items + " items"
    })
    if (window.parent !== window) {
      window.parent.postMessage(payload, "*")
    }
  </script>
</body>
</html>`

const sameOriginRedirect = (origin, candidate, fallback) => {
  try {
    const url = new URL(candidate)
    if (url.origin === origin) return url.href
  } catch {}
  return fallback
}

const cookieMap = (header) => {
  const out = {}
  for (const part of (header ?? "").split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq < 0) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const route = pages[url.pathname] ? url.pathname : "/"
    const page = pages[route]
    const locked = route === "/locked"
    const accessOrigin = env.ACCESS_ORIGIN || ""
    const sameSite = (env.ACCESS_SAMESITE || "none").toLowerCase()
    const authorized = cookieMap(request.headers.get("cookie")).CF_Authorization === "proto-access"
    if (url.pathname === "/__meta") {
      return Response.json({
        role: "app",
        origin: url.origin,
        canvasOrigin: env.CANVAS_ORIGIN,
        accessOrigin: accessOrigin || null,
        sameSite,
        authorized,
        route
      })
    }
    if (accessOrigin && url.pathname === "/cdn-cgi/access/callback") {
      const next = sameOriginRedirect(url.origin, url.searchParams.get("redirect_url") ?? url.origin + "/checkout", url.origin + "/checkout")
      if (url.searchParams.get("token") !== "proto-access") {
        return new Response("bad token", { status: 400 })
      }
      const cookie = [
        "CF_Authorization=proto-access",
        "Path=/",
        "HttpOnly",
        "Max-Age=86400",
        "SameSite=" + (sameSite === "lax" ? "Lax" : "None"),
        "Secure"
      ].join("; ")
      return new Response(null, {
        status: 302,
        headers: {
          location: next,
          "set-cookie": cookie
        }
      })
    }
    if (accessOrigin && !authorized) {
      const login = new URL("/cdn-cgi/access/login", accessOrigin)
      login.searchParams.set("redirect_url", url.href)
      return new Response(null, {
        status: 302,
        headers: { location: login.href }
      })
    }
    const headers = {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": env.CANVAS_ORIGIN,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers })
    }
    if (locked) {
      headers["x-frame-options"] = "DENY"
      headers["content-security-policy"] = "frame-ancestors 'none'"
    } else {
      headers["content-security-policy"] = `frame-ancestors ${env.CANVAS_ORIGIN}`
    }
    return new Response(html({ origin: url.origin, route, page }), { headers })
  }
}
