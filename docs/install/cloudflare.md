# Install Crit on Cloudflare

This guide walks you through deploying Crit in your Cloudflare account.

Authors keep working locally with `crit dev`. After they share a Canvas, teammates review it in a browser at your Crit URL. Teammates sign in with Cloudflare Access. They do not install Crit.

This guide covers the Crit installation only. If you need to wire up live app previews inside Frames, use the [`install-crit-frame-bridge`](../../skills/install-crit-frame-bridge/SKILL.md) skill separately.

Agents deploying Crit should use the [`install-crit-cloudflare`](../../skills/install-crit-cloudflare/SKILL.md) skill. Crit v1 requires Cloudflare Access on the installation URL to identify people. A public URL without Access is not a supported team setup.

## What you are setting up

You deploy one Crit installation in your Cloudflare account. That installation provides:

- the hosted review website
- team sign-in through Cloudflare Access
- shared Canvas storage and sync for authors
- storage for captured snapshots

One installation serves one company or team. Crit v1 does not support multiple organizations inside one install.

## Two URLs to know

You will work with two kinds of web addresses:

| URL | Example | What it is for |
|---|---|---|
| Crit installation | `https://crit.acme.internal` | Where teammates review shared work and where authors run `crit login` |
| App preview | `https://preview-abc123.pages.dev/` | Where live app pages load inside Frames during review |

Preview URLs are registered separately after each deploy. They are not stored inside Canvas files.

## Before you start

You will need:

- a Cloudflare account with Workers, D1, R2, and Access enabled
- Node.js 22.16.0 or newer
- DNS for your Crit hostname on Cloudflare, or a temporary `*.workers.dev` address for testing
- a long random password for `CRIT_DEPLOY_TOKEN` (used by CI to register previews)

## 1. Check out Crit

Deploy from the Crit source repository.

```sh
git clone https://github.com/wking-io/crit.git
cd crit
npm ci
```

Use a release tag when one is available.

## 2. Build the hosted review website

Build the browser UI, then copy it into the Worker package.

```sh
npm run build --workspace @crit/host
rm -rf packages/cloudflare/assets/*
cp -r packages/host/dist-web/* packages/cloudflare/assets/
```

Do not skip the copy step. The placeholder file in `packages/cloudflare/assets` is not enough on its own.

## 3. Create Cloudflare resources

From the Worker package directory:

```sh
cd packages/cloudflare
npx wrangler d1 create crit-control
npx wrangler r2 bucket create crit-artifacts
```

Save the D1 `database_id` from the create output. You will paste it into the config in the next step.

## 4. Configure Wrangler

Edit [`packages/cloudflare/wrangler.jsonc`](../../packages/cloudflare/wrangler.jsonc).

### Set your database id

Replace the placeholder D1 id with the one from step 3:

```jsonc
"d1_databases": [
  {
    "binding": "CONTROL",
    "database_name": "crit-control",
    "database_id": "<database-id-from-wrangler-d1-create>"
  }
]
```

Leave the Durable Object migration block in place. It is required on first deploy:

```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["CanvasDurableObject"]
  }
]
```

### Set your Crit hostname

Point the Worker at your company Crit URL. Example:

```jsonc
"routes": [
  {
    "pattern": "crit.acme.internal/*",
    "zone_name": "acme.internal"
  }
]
```

For a quick test before DNS is ready, leave out `routes` and use the `*.workers.dev` URL Wrangler prints after deploy. Production should use a stable company hostname.

### Set the deployment token

Remove the test value from `vars` in production:

```jsonc
"vars": {
  "CRIT_DEPLOY_TOKEN": "test-deploy-token"
}
```

Set a real secret:

```sh
npx wrangler secret put CRIT_DEPLOY_TOKEN
```

Use the same value in CI as the `CRIT_DEPLOY_TOKEN` secret for preview registration.

## 5. Deploy

```sh
cd packages/cloudflare
npx wrangler deploy
```

When deploy finishes, note the URL Wrangler prints if you are using `*.workers.dev`.

## 6. Turn on Cloudflare Access

Create a Cloudflare Access application for your Crit hostname.

Add every author and reviewer who needs to share or review work. Crit checks that each request came through Access before serving protected pages and APIs.

Preview registration from CI is different. It uses the `CRIT_DEPLOY_TOKEN` bearer token on `POST /deployments`, not a person's Access login.

Authors connect with:

```sh
npx crit login https://crit.acme.internal
```

That command only works once the author can reach the Crit URL through Access.

## 7. Check that it works

Replace `https://crit.acme.internal` with your Crit URL.

### Sign-in endpoint

```sh
curl -sS -H 'Cf-Access-Authenticated-User-Email: you@acme.com' \
  https://crit.acme.internal/identity
```

You should get `200` and your email back as JSON. Without Access, you should get `401`.

### Review website

```sh
curl -sS -H 'accept: text/html' \
  -H 'Cf-Access-Authenticated-User-Email: you@acme.com' \
  https://crit.acme.internal/
```

You should get `200` and an HTML page.

### Shared Canvas list

```sh
curl -sS -H 'Cf-Access-Authenticated-User-Email: you@acme.com' \
  https://crit.acme.internal/canvas
```

You should get `200`. A new installation returns an empty list.

### Preview registration

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

You should get `200`. A wrong or missing token should return `401`.

### Routes that should not exist

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://crit.acme.internal/mcp
```

You should get `404`. Crit has no MCP server in v1.

## 8. Connect your team

After the installation is live:

```sh
npx crit login https://crit.acme.internal
npx crit share checkout-redesign
```

To register app previews from CI, follow [Register previews from CI](../../README.md#register-previews-from-ci) in the README. Set these repository secrets:

- `CRIT_INSTALLATION_URL` — your Crit URL, for example `https://crit.acme.internal`
- `CRIT_DEPLOY_TOKEN` — the same token you set in step 4

Teammates open your Crit URL in a browser, sign in with Access, and review shared Canvases. They do not install Crit.

## Upgrade later

To ship a new version:

1. Check out the new Crit release.
2. Repeat step 2 to rebuild and copy the review website.
3. Apply any new migration entries added to `wrangler.jsonc`.
4. Run `npx wrangler deploy` from `packages/cloudflare`.

Backup, restore, and incident runbooks are documented separately.

## Related reading

- [README — Target Cloudflare deployment](../../README.md#target-cloudflare-deployment)
- [Register previews from CI](../../README.md#register-previews-from-ci)
- [Frame Bridge setup](../../skills/install-crit-frame-bridge/SKILL.md)
