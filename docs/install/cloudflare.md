# Install Crit on Cloudflare

Deploy Crit's shared collaboration surface in your Cloudflare account. One installation is one tenant. Authors still work locally with `crit dev`; after share, teammates review in the hosted UI through Cloudflare Access. They do not install Crit.

This guide covers the Installation Worker only. Preview `frame-ancestors`, optional Access on application previews, and Frame Bridge setup live in the [`install-crit-frame-bridge`](../../skills/install-crit-frame-bridge/SKILL.md) skill.

## What you deploy

One Worker deployment serves:

- the hosted review UI and Workers Static Assets
- the remote Canvas authority API
- D1 control-plane metadata
- one SQLite Durable Object per shared Canvas
- immutable artifacts in R2

v1 uses one implicit default Workspace (`workspace_default`). It does not expose workspace switching. Crit does not publish `/mcp` or agent OAuth routes.

## Hostname layout

Use two kinds of HTTPS origins:

| Origin | Example | Purpose |
|---|---|---|
| Installation hostname | `https://crit.acme.internal` | Hosted review UI, share, sync, identity, artifacts, deployment registration |
| Application preview origins | `https://preview-abc123.pages.dev/` | Registered review Deployments for live Frames |

The Installation hostname is what authors pass to `crit login` and `crit share`. Preview origins are registered separately with `crit register-deployment` from CI or by hand. Canvas state never stores preview URLs.

## Prerequisites

- A Cloudflare account with Workers, D1, R2, and Access enabled
- Node.js `>=22.16.0`
- Wrangler CLI (the repo pins Wrangler through npm)
- DNS for your Installation hostname on Cloudflare, or a temporary `*.workers.dev` hostname for smoke testing
- A long random value for `CRIT_DEPLOY_TOKEN` (preview registration from CI)

## 1. Check out Crit

Deploy from the Crit source tree. The Worker package is `@crit/cloudflare` in this repository; it is not published separately.

```sh
git clone https://github.com/wking-io/crit.git
cd crit
npm ci
```

Use a release tag when one exists. `main` is the rewrite branch described in [README](../../README.md).

## 2. Build the hosted review UI

The Worker serves the browser UI from Static Assets. Build the host bundle, then copy it into the Worker assets directory.

```sh
npm run build --workspace @crit/host
rm -rf packages/cloudflare/assets/*
cp -r packages/host/dist-web/* packages/cloudflare/assets/
```

The v1 Worker expects `packages/host/dist-web` contents in `packages/cloudflare/assets`. Do not deploy the placeholder `assets/index.html` alone.

## 3. Create Cloudflare resources

Run these from `packages/cloudflare`:

```sh
cd packages/cloudflare
npx wrangler d1 create crit-control
npx wrangler r2 bucket create crit-artifacts
```

Copy the D1 `database_id` from the create output.

## 4. Configure Wrangler

Edit [`packages/cloudflare/wrangler.jsonc`](../../packages/cloudflare/wrangler.jsonc).

### Bindings already in the repo

The checked-in config defines:

| Binding | Resource | Purpose |
|---|---|---|
| `CONTROL` | D1 database `crit-control` | Canvas directory and Deployment registry |
| `CANVASES` | Durable Object `CanvasDurableObject` | One SQLite authority per shared Canvas |
| `ARTIFACTS` | R2 bucket `crit-artifacts` | Immutable artifact bytes |
| `ASSETS` | Workers Static Assets | Hosted review UI |
| `CRIT_DEPLOY_TOKEN` | Worker var or secret | Machine auth for `POST /deployments` |

Replace the placeholder D1 id:

```jsonc
"d1_databases": [
  {
    "binding": "CONTROL",
    "database_name": "crit-control",
    "database_id": "<database-id-from-wrangler-d1-create>"
  }
]
```

### Durable Object migration

The repo already declares the v1 migration:

```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["CanvasDurableObject"]
  }
]
```

Do not remove this block on first deploy. Future Canvas Durable Object schema changes add new migration tags here.

### Installation route

Attach your Installation hostname. Example for a zone managed in the same Cloudflare account:

```jsonc
"routes": [
  {
    "pattern": "crit.acme.internal/*",
    "zone_name": "acme.internal"
  }
]
```

For a smoke test before DNS is ready, omit `routes` and use the default `*.workers.dev` hostname Wrangler prints after deploy. Production should use a stable company hostname protected by Access.

### Deployment token

Remove the test default from `vars` in production:

```jsonc
"vars": {
  "CRIT_DEPLOY_TOKEN": "test-deploy-token"
}
```

Set a real secret instead:

```sh
npx wrangler secret put CRIT_DEPLOY_TOKEN
```

Wrangler secrets override `vars`. Keep the same value in CI as `CRIT_DEPLOY_TOKEN` for `crit register-deployment`.

## 5. Deploy the Worker

```sh
cd packages/cloudflare
npx wrangler deploy
```

Wrangler bundles `src/worker.ts`, applies the Durable Object migration, and publishes Static Assets.

## 6. Protect the Installation with Cloudflare Access

Create an Access application for the Installation hostname. Include every author and reviewer who needs hosted review or share.

The Worker trusts Cloudflare Access identity through the `Cf-Access-Authenticated-User-Email` request header ([`packages/cloudflare/src/access.ts`](../../packages/cloudflare/src/access.ts)). Requests without a valid Access email receive `401` on protected routes.

### Routes and authentication

| Route | Auth | Notes |
|---|---|---|
| `GET /identity` | Access | Used by `crit login` |
| `GET /canvas` | Access | Canvas directory |
| `POST /canvas` | Access | First share from an author |
| `GET /canvas/:id` | Access | Open Canvas authority view or hosted UI document |
| `GET /canvas/:id/changes` | Access | Pull accepted changes |
| `POST /canvas/:id/changes` | Access | Submit changes |
| `GET /artifacts/:id?digest=…` | Access | Read artifact bytes |
| `PUT /artifacts/:id` | Access | Store artifact bytes |
| `POST /representations/application-route` | Access | Resolve Application Routes to registered previews |
| `GET /`, `GET /canvas/:id` (HTML) | Access | Hosted review UI shell |
| `POST /deployments` | Bearer `CRIT_DEPLOY_TOKEN` | Preview registration from CI; not Access user email |

`POST /deployments` is machine-authenticated. It does not use Access user identity.

Authors run `crit login` against the Installation hostname after they can reach `/identity` as an Access-authenticated caller. Share and sync use that bound Person.

## 7. Verify the installation

Replace `https://crit.acme.internal` with your Installation origin.

### Access identity

```sh
curl -sS -H 'Cf-Access-Authenticated-User-Email: you@acme.com' \
  https://crit.acme.internal/identity
```

Expect `200` and JSON like:

```json
{
  "kind": "access-authenticated-person",
  "schemaVersion": 1,
  "address": "you@acme.com"
}
```

Without the Access header, expect `401`.

### Hosted UI shell

```sh
curl -sS -H 'accept: text/html' \
  -H 'Cf-Access-Authenticated-User-Email: you@acme.com' \
  https://crit.acme.internal/
```

Expect `200`, `content-type: text/html`, and a document containing `id="root"`.

### Canvas directory

```sh
curl -sS -H 'Cf-Access-Authenticated-User-Email: you@acme.com' \
  https://crit.acme.internal/canvas
```

Expect `200` and a `canvas-directory` payload. An empty installation returns `"canvases": []`.

### Deployment registration

```sh
curl -sS -X POST \
  -H "authorization: Bearer ${CRIT_DEPLOY_TOKEN}" \
  -H 'content-type: application/json' \
  --data '{
    "kind": "register-deployment",
    "schemaVersion": 1,
    "applicationId": "application_smoke",
    "channel": "review",
    "url": "https://preview.example.com/"
  }' \
  https://crit.acme.internal/deployments
```

Expect `200` and a `deployment-registered` receipt. A missing or wrong bearer token returns `401`.

### Explicit non-routes

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://crit.acme.internal/mcp
```

Expect `404`. Agent OAuth routes are likewise absent.

## 8. Connect authors and register previews

After the Installation is live:

```sh
npx crit login https://crit.acme.internal
npx crit share checkout-redesign
```

Register application preview origins from CI with `crit register-deployment`. See [Register previews from CI](../../README.md#register-previews-from-ci) in the README for the GitHub Actions pattern and required secrets:

- `CRIT_INSTALLATION_URL`
- `CRIT_DEPLOY_TOKEN`

`applicationId` comes from the project's `crit.manifest.json`. The default channel is `review`.

Teammates open the Installation hostname in a browser, sign in with Access, and review shared Canvases in the hosted UI. They do not install Crit.

## Control-plane and ledger storage

There are no checked-in D1 SQL migration files. Storage comes up as follows:

- **D1 (`CONTROL`)** — `canvas_shares` and `deployments` tables are created on first use with `CREATE TABLE IF NOT EXISTS` in the Worker.
- **Canvas Durable Objects** — each Canvas applies the authority schema from [`packages/cloudflare/src/schema.ts`](../../packages/cloudflare/src/schema.ts) on first open inside the object SQLite database.
- **R2 (`ARTIFACTS`)** — artifact objects are written on `PUT /artifacts/:id`.

D1 stores directory and Deployment metadata only. Canonical Canvas content lives in Durable Objects. D1 is not the Canvas ledger.

## Upgrade and redeploy

To ship a new Worker or hosted UI version:

1. Check out the new Crit revision.
2. Rebuild and recopy the host assets (step 2).
3. Apply any new Durable Object migration tags added to `wrangler.jsonc`.
4. Run `npx wrangler deploy` from `packages/cloudflare`.

Backup, restore, retention, and incident runbooks are separate release work tracked in [v1-todo](../plans/001-cloudflare-native-v1/v1-todo.md).

## Related reading

- [README — Target Cloudflare deployment](../../README.md#target-cloudflare-deployment)
- [Phase 6 — Cloudflare authority and control plane](../plans/001-cloudflare-native-v1/phase-06-cloudflare-platform.md)
- [Phase 9 — Installation, operations, and v1 release](../plans/001-cloudflare-native-v1/phase-09-release.md)
- [Testing — Installation workflow](../plans/001-cloudflare-native-v1/testing.md#installation-workflow)
