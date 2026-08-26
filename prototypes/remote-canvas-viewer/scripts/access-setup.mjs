import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"

const wranglerConfig = () => {
  const text = readFileSync(homedir() + "/.config/.wrangler/config/default.toml", "utf8")
  const token = /oauth_token\s*=\s*"([^"]+)"/.exec(text)?.[1]
  if (!token) throw new Error("Run wrangler login --device first")
  return token
}

const account = process.env.WRANGLER_ACCOUNT_ID ?? "1c83a9fc7665b0f9891ec478df5d6225"
const token = process.env.CLOUDFLARE_USE_ENV_TOKEN === "1"
  ? process.env.CLOUDFLARE_API_TOKEN
  : wranglerConfig()
if (!token) throw new Error("No Cloudflare token. Run ./scripts/wrangler-login.sh")
const email = process.env.ACCESS_TEST_EMAIL ?? "contact@wking.dev"
const allowIframe = process.env.ACCESS_ALLOW_IFRAME !== "0"
const appName = "proto-remote-app"
const canvasName = "proto-remote-canvas"

const api = async (method, path, body) => {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await response.json()
  if (!json.success) {
    throw new Error(method + " " + path + " " + JSON.stringify(json.errors))
  }
  return json.result
}

const deploy = (name, vars) => {
  const args = ["wrangler", "deploy", "--name", name]
  for (const [key, value] of Object.entries(vars)) {
    args.push("--var", key + ":" + value)
  }
  const env = { ...process.env }
  delete env.CLOUDFLARE_API_TOKEN
  delete env.CLOUDFLARE_ACCOUNT_ID
  const result = spawnSync("npx", args, {
    cwd: new URL("../" + (name === canvasName ? "canvas" : "app"), import.meta.url),
    stdio: "inherit",
    env
  })
  if (result.status) throw new Error("deploy failed for " + name)
}

const subdomain = await api("GET", "/accounts/" + account + "/workers/subdomain")
const canvasOrigin = "https://" + canvasName + "." + subdomain.subdomain + ".workers.dev"
const appOrigin = "https://" + appName + "." + subdomain.subdomain + ".workers.dev"

deploy(appName, { CANVAS_ORIGIN: canvasOrigin })
deploy(canvasName, { APP_ORIGIN: appOrigin })

const existing = await api("GET", "/accounts/" + account + "/access/apps")
const already = (existing ?? []).find((app) => app.name === "proto-remote-app Access")
const payload = {
  type: "self_hosted",
  name: "proto-remote-app Access",
  allow_iframe: allowIframe,
  same_site_cookie_attribute: "none",
  cors_headers: {
    allowed_origins: [canvasOrigin],
    allowed_methods: ["GET", "HEAD", "OPTIONS"],
    allow_all_headers: true,
    allow_credentials: true
  },
  destinations: [{ type: "worker", worker_id: appName }],
  policies: [{
    name: "email",
    decision: "allow",
    include: [{ email: { email } }]
  }]
}

const app = already === undefined
  ? await api("POST", "/accounts/" + account + "/access/apps", payload)
  : await api("PUT", "/accounts/" + account + "/access/apps/" + already.id, payload)

await api("PUT", "/accounts/" + account + "/access/apps/" + app.id + "/settings", {
  allow_iframe: allowIframe
})

const probe = await fetch(appOrigin + "/checkout", { redirect: "manual" })
console.log(JSON.stringify({
  canvasOrigin,
  appOrigin,
  allowIframe,
  email,
  accessAppId: app.id,
  checkoutStatus: probe.status,
  location: probe.headers.get("location"),
  xfo: probe.headers.get("x-frame-options"),
  csp: probe.headers.get("content-security-policy")
}, null, 2))
