const login = ({ appOrigin, canvasOrigin, allowIframe, redirectUrl }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Access gate mock</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font: 16px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: #f4f6fb;
      color: #1b2430;
    }
    main {
      width: min(420px, calc(100% - 32px));
      background: #fff;
      border: 1px solid #d5dbe6;
      border-radius: 12px;
      padding: 24px;
    }
    .kicker { color: #5b6b80; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 6px 0 10px; font-size: 24px; }
    p { color: #3b4756; }
    code { font-size: 12px; word-break: break-all; }
    button {
      appearance: none;
      border: 0;
      margin-top: 12px;
      background: #f48120;
      color: #fff;
      border-radius: 999px;
      padding: 10px 14px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <main>
    <div class="kicker">Mock · not Zero Trust</div>
    <h1>Sign in to continue</h1>
    <p>This origin stands in for <code>team.cloudflareaccess.com</code>. The preview origin redirected here because it had no <code>CF_Authorization</code> cookie.</p>
    <p><b>allow_iframe</b> ${allowIframe ? "on" : "off"}</p>
    <p><b>Return to</b> <code>${redirectUrl}</code></p>
    <form method="post" action="/cdn-cgi/access/login">
      <input type="hidden" name="redirect_url" value="${redirectUrl}">
      <button type="submit" id="signin">Sign in as reviewer</button>
    </form>
  </main>
  <script>
    if (window.parent !== window) {
      window.parent.postMessage({
        source: "proto-access",
        status: "gate",
        allowIframe: ${allowIframe ? "true" : "false"},
        appOrigin: ${JSON.stringify(appOrigin)}
      }, ${JSON.stringify(canvasOrigin)})
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const allowIframe = env.ACCESS_ALLOW_IFRAME !== "0"
    const appOrigin = env.APP_ORIGIN
    const canvasOrigin = env.CANVAS_ORIGIN
    if (url.pathname === "/__meta") {
      return Response.json({
        role: "access",
        origin: url.origin,
        appOrigin,
        canvasOrigin,
        allowIframe
      })
    }

    const fallback = appOrigin + "/checkout"
    const redirectUrl = sameOriginRedirect(appOrigin, url.searchParams.get("redirect_url") ?? fallback, fallback)

    if (request.method === "POST" && url.pathname === "/cdn-cgi/access/login") {
      const body = await request.formData().catch(() => new URLSearchParams())
      const next = sameOriginRedirect(appOrigin, String(body.get("redirect_url") ?? redirectUrl), fallback)
      const callback = new URL("/cdn-cgi/access/callback", appOrigin)
      callback.searchParams.set("token", "proto-access")
      callback.searchParams.set("redirect_url", next)
      return Response.redirect(callback.href, 302)
    }

    const headers = {
      "content-type": "text/html; charset=utf-8"
    }
    if (allowIframe) {
      headers["content-security-policy"] = `frame-ancestors ${canvasOrigin}`
    } else {
      headers["x-frame-options"] = "SAMEORIGIN"
      headers["content-security-policy"] = "frame-ancestors 'none'"
    }

    return new Response(login({
      appOrigin,
      canvasOrigin,
      allowIframe,
      redirectUrl
    }), { headers })
  }
}
