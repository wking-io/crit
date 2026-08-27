---
name: install-crit-frame-bridge
description: Install and configure @crit/frame-bridge in a web application. Use when application Frames need route reporting through the official adapter, when adding the HTML renderer or Vite adapter, when proving ordinary production stays unmarked, when a shared review preview must send frame-ancestors for the Crit host, or when a Cloudflare Access-gated preview needs allow_iframe.
---

# Install Frame Bridge

The host owns activation. The adapter receives a validated parent origin or does not exist. The adapter only reports route. The host assigns iframe src to the preview origin. Crit does not proxy that origin.

## Start

1. Inspect the package manager, framework, HTML entry point, development command, production build, production preview, environment loading, Content Security Policy, `X-Frame-Options`, Access, Turnstile, Bot Fight, and Under Attack on the preview hostname. Finish when every command, header, and injection boundary is known.
2. Install `@crit/frame-bridge` with the project's package manager. Finish when the project manifest records it.
3. Name the host's local-development condition and shared-review-preview mode. Finish when ordinary production matches neither condition.

## Activation

Use this closed policy:

- Local development is active.
- A build in the explicit `crit-review-preview` mode is active.
- Ordinary production builds and previews are inactive.
- A missing or malformed `CRIT_PARENT_ORIGIN` is inactive.

Keep this choice in the server or build configuration. Application components receive no bridge flag.

## HTML first

Use the framework-neutral renderer at the server or build HTML boundary:

```ts
import {
  parseFrameBridgeParentOrigin,
  renderFrameRouteBridgeTag
} from "@crit/frame-bridge/html"

const parentOrigin = wantsBridge
  ? parseFrameBridgeParentOrigin(process.env.CRIT_PARENT_ORIGIN)
  : undefined
const bridgeTag = parentOrigin === undefined
  ? ""
  : renderFrameRouteBridgeTag({ parentOrigin })
```

Insert `bridgeTag` immediately after the opening `head` tag. Keep it empty when the policy or origin parser disables the bridge.

## Vite

Use the optional Vite leaf when the project uses Vite:

```ts
import { parseFrameBridgeParentOrigin } from "@crit/frame-bridge/html"
import {
  frameAncestorsPreviewVitePlugin,
  frameRouteBridgeVitePlugin
} from "@crit/frame-bridge/vite"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "CRIT_")
  const wantsBridge =
    (command === "serve" && mode === "development") ||
    mode === "crit-review-preview"
  const wantsPreviewFrameAncestors = mode === "crit-review-preview"
  const parentOrigin = wantsBridge
    ? parseFrameBridgeParentOrigin(env.CRIT_PARENT_ORIGIN)
    : undefined

  return {
    plugins: [
      parentOrigin === undefined
        ? undefined
        : frameRouteBridgeVitePlugin({ parentOrigin }),
      wantsPreviewFrameAncestors && parentOrigin !== undefined
        ? frameAncestorsPreviewVitePlugin({ parentOrigin })
        : undefined
    ]
  }
})
```

Set `CRIT_PARENT_ORIGIN` to the exact HTTP or HTTPS origin of the Crit parent page. In preview CI, set it to `CRIT_INSTALLATION_URL`. Keep credentials, paths, queries, fragments, and wildcard targets out of this value.

## Frame the preview

Use the headers helper on shared-review-preview responses only. Browsers ignore `frame-ancestors` in a meta tag.

```ts
import { parseFrameBridgeParentOrigin } from "@crit/frame-bridge/html"
import {
  renderCloudflarePagesHeadersFile,
  renderFrameAncestorsResponseHeaders
} from "@crit/frame-bridge/headers"

const parentOrigin = wantsPreviewFrameAncestors
  ? parseFrameBridgeParentOrigin(process.env.CRIT_PARENT_ORIGIN)
  : undefined
const frameAncestorsHeaders = parentOrigin === undefined
  ? {}
  : renderFrameAncestorsResponseHeaders({ parentOrigin })
```

For Vite preview, add `frameAncestorsPreviewVitePlugin` only in `crit-review-preview` mode. For Cloudflare Pages, write `renderCloudflarePagesHeadersFile({ parentOrigin })` into `dist/_headers` before deploy. For a Worker, merge `frameAncestorsHeaders` into the HTML response headers.

Ordinary production responses do not name the Crit host in `frame-ancestors`.

Turnstile, Bot Fight, and Under Attack wrap the preview in a challenge that sends `X-Frame-Options: SAMEORIGIN`. Leave those off the review-preview hostname.

Finish when `curl -sI` of the review-preview HTML includes `frame-ancestors` with the Crit origin and no blocking `X-Frame-Options`.

## When the preview is behind Access

Run this section when an unauthenticated request to the preview origin 302s to `*.cloudflareaccess.com`, or when the user wants Access on that preview.

Crit Access authenticates the Installation hostname. Preview Access is the customer's. Crit does not require Access on the preview.

1. Use `CLOUDFLARE_API_TOKEN` with Account, Access: Apps and Policies, Edit. `wrangler login` OAuth can deploy Workers. It cannot list or edit Access apps.
2. Read `CLOUDFLARE_ACCOUNT_ID` or `npx wrangler whoami`.
3. `GET /accounts/{account_id}/access/apps`. Find the app whose destination is this Worker. If none exists and the user wants one, `POST` a self-hosted app with `destinations: [{ "type": "worker", "worker_id": "<worker id>" }]`. Use `all_preview_workers` when one app should cover every current and future preview. `all_workers` also gates production.
4. `PUT /accounts/{account_id}/access/apps/{app_id}` with the existing policy plus `allow_iframe: true` and `same_site_cookie_attribute: "none"`. Then `PUT /accounts/{account_id}/access/apps/{app_id}/settings` with `{ "allow_iframe": true }`.
5. Add `cors_headers` for the Crit origin only when Crit `fetch`es the preview. The Frame path is iframe `src` plus `postMessage`. It does not need CORS.

Finish when the Access login page for the preview origin has no `X-Frame-Options` and no `frame-ancestors 'none'`.

The Access login can sit in the Frame. The Cloudflare account IdP at `dash.cloudflare.com` sends `X-Frame-Options: SAMEORIGIN`. First sign-in for that IdP happens in a top-level tab. After that, `CF_Authorization` is SameSite None and the Frame reuses it. An email OTP IdP can stay in the Frame.

## Verify

1. Run the real local-development command. Fetch its HTML and require exactly one `data-crit-route-bridge` marker with the configured parent origin.
2. Run the real ordinary production build. Search every emitted file and require zero markers.
3. Start the real production preview from that build. Fetch its HTML and require zero markers. Require the Crit origin absent from `frame-ancestors`.
4. Build in `crit-review-preview` mode with the parent origin set. Require exactly one marker. Require the HTML response `frame-ancestors` header to include the Crit origin. Use `frameAncestorsNamesOrigin` from `@crit/frame-bridge/headers` when checking a response header.
5. When the preview is Access-gated, fetch the Access login URL and require no `X-Frame-Options` and no `frame-ancestors 'none'`.
