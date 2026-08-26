const routes = {
  checkout: "/checkout",
  account: "/account",
  locked: "/locked"
}

const html = ({ appOrigin, canvasOrigin }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Remote canvas viewer prototype</title>
  <style>
    :root {
      --ink: #e8e4db;
      --mute: #9a9488;
      --board: #1b1a17;
      --panel: #12110f;
      --line: #2c2a25;
      --live: #7dce8a;
      --blocked: #e07a6a;
      --wait: #d4b36a;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      font: 14px/1.45 ui-sans-serif, system-ui, sans-serif;
      background: var(--board);
      color: var(--ink);
      display: grid;
      grid-template-columns: 320px 1fr;
    }
    aside {
      background: var(--panel);
      border-right: 1px solid var(--line);
      padding: 20px 18px;
      overflow: auto;
    }
    h1 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
    .question { color: var(--mute); margin: 0 0 16px; }
    .origins {
      display: grid;
      gap: 8px;
      margin: 0 0 16px;
    }
    .origins div {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .origins b { display: block; color: var(--mute); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .origins code { font-size: 12px; word-break: break-all; }
    .switcher { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
    button {
      appearance: none;
      border: 1px solid var(--line);
      background: #1d1c18;
      color: var(--ink);
      border-radius: 999px;
      padding: 6px 10px;
      cursor: pointer;
    }
    button[aria-pressed="true"] { border-color: #6f8f6a; background: #243022; }
    pre {
      margin: 0;
      padding: 10px;
      border-radius: 8px;
      background: #0d0c0b;
      border: 1px solid var(--line);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .board {
      position: relative;
      overflow: hidden;
      background-image:
        linear-gradient(#23211c 1px, transparent 1px),
        linear-gradient(90deg, #23211c 1px, transparent 1px);
      background-size: 40px 40px;
    }
    .frame {
      position: absolute;
      top: 56px;
      left: 48px;
      width: min(920px, calc(100% - 96px));
      height: calc(100% - 112px);
      display: flex;
      flex-direction: column;
      background: #0f0e0c;
      border: 1px solid #3a372f;
      border-radius: 12px;
      box-shadow: 0 24px 60px #0008;
    }
    .chrome {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
    }
    .chrome span { color: var(--mute); }
    .status { font-weight: 600; }
    .status.live { color: var(--live); }
    .status.blocked { color: var(--blocked); }
    .status.loading { color: var(--wait); }
    iframe {
      flex: 1;
      width: 100%;
      border: 0;
      background: #fff;
      border-radius: 0 0 12px 12px;
    }
  </style>
</head>
<body>
  <aside>
    <h1>Throwaway prototype</h1>
    <p class="question">Can a Cloudflare Worker canvas on this origin show a live app Worker on a different origin inside a Frame?</p>
    <div class="origins">
      <div><b>Canvas host</b><code id="canvas-origin"></code></div>
      <div><b>App preview</b><code id="app-origin"></code></div>
    </div>
    <div class="switcher">
      <button type="button" data-route="checkout" aria-pressed="true">Checkout</button>
      <button type="button" data-route="account">Account</button>
      <button type="button" data-route="locked">Locked</button>
    </div>
    <pre id="state"></pre>
  </aside>
  <main class="board">
    <article class="frame">
      <div class="chrome">
        <span id="frame-label">application-route · /checkout</span>
        <span id="frame-status" class="status loading">loading</span>
      </div>
      <iframe id="live" title="Live application route"></iframe>
    </article>
  </main>
  <script>
    const appOrigin = ${JSON.stringify(appOrigin)}
    const canvasOrigin = ${JSON.stringify(canvasOrigin)}
    const routes = ${JSON.stringify(routes)}
    const iframe = document.getElementById("live")
    const stateEl = document.getElementById("state")
    const statusEl = document.getElementById("frame-status")
    const labelEl = document.getElementById("frame-label")
    const buttons = [...document.querySelectorAll("[data-route]")]
    let wait = 0
    const state = {
      canvasOrigin,
      appOrigin,
      sameOrigin: canvasOrigin === appOrigin,
      route: routes.checkout,
      framing: "allowed",
      status: "loading",
      reported: null
    }

    const paint = () => {
      document.getElementById("canvas-origin").textContent = state.canvasOrigin
      document.getElementById("app-origin").textContent = state.appOrigin
      labelEl.textContent = "application-route · " + state.route
      statusEl.textContent = state.status
      statusEl.className = "status " + state.status
      stateEl.textContent = JSON.stringify(state, null, 2)
      document.body.dataset.proof = state.status
    }

    const show = (name) => {
      clearTimeout(wait)
      state.route = routes[name]
      state.framing = name === "locked" ? "denied" : "allowed"
      state.status = "loading"
      state.reported = null
      buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.route === name)))
      iframe.src = appOrigin + state.route
      wait = setTimeout(() => {
        if (state.status === "loading") {
          state.status = "blocked"
          paint()
        }
      }, 1500)
      paint()
    }

    window.addEventListener("message", (event) => {
      if (event.origin !== appOrigin) return
      if (event.data?.source !== "proto-remote-app") return
      state.status = "live"
      state.reported = event.data
      paint()
    })

    buttons.forEach((button) => button.addEventListener("click", () => show(button.dataset.route)))
    show("checkout")
  </script>
</body>
</html>`

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const body = {
      role: "canvas",
      origin: url.origin,
      appOrigin: env.APP_ORIGIN
    }
    if (url.pathname === "/__meta") {
      return Response.json(body)
    }
    return new Response(html({
      appOrigin: env.APP_ORIGIN,
      canvasOrigin: url.origin
    }), {
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  }
}
