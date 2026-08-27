---
name: install-crit-cloudflare
description: Deploy Crit in a customer Cloudflare account. Use when the user asks to install Crit on Cloudflare, set up the Crit Worker, configure Wrangler, D1, R2, Access, or choose between a company hostname and workers.dev.
---

# Install Crit on Cloudflare

Deploy Crit once in the customer's Cloudflare account. Authors keep using `crit dev` locally. Teammates review in the browser at the Crit URL.

Read [`docs/install/cloudflare.md`](../../docs/install/cloudflare.md) for the full command list. Prefer that file over this one for exact flags and config snippets.

## Identity

Crit supports two installation modes:

| Mode | When | Who people are |
|---|---|---|
| Access-backed | Cloudflare Access protects the Crit URL | Named company people from Access |
| Anonymous | No Access on the Crit URL | One shared anonymous person |

When Access is not set up, Crit does not reject human requests. `/identity` returns an anonymous person. Share, review, and sync still work, but attribution is anonymous.

When Access is set up later, requests that arrive with a valid Access email use that person instead.

Use [`skills/crit-identity/SKILL.md`](../crit-identity/SKILL.md) when login or hosted sign-in fails after Access exists.

## Choose the Crit URL

Ask which hostname mode they want.

| Mode | Crit URL example | Extra setup |
|---|---|---|
| Company hostname | `https://crit.acme.internal` | DNS on Cloudflare and a `routes` entry in `wrangler.jsonc` |
| Workers.dev | `https://crit-cloudflare.<subdomain>.workers.dev` | Skip `routes`; use the URL Wrangler prints after deploy |

The difference is naming and DNS only. Build steps, D1, R2, deploy token, and verification are the same.

Record the chosen URL as `CRIT_INSTALLATION_URL` for authors and CI.

## Start

1. Confirm the Cloudflare account has Workers, D1, and R2 enabled. Access is optional.
2. Confirm Node.js 22.16.0 or newer and the Crit source tree are available.
3. Pick company hostname or `workers.dev` using the table above.
4. Open `docs/install/cloudflare.md` and follow it step by step.

## Deploy checklist

Work from the Crit repository root unless a step says otherwise.

1. **Check out Crit** — `git clone`, `npm ci`, use a release tag when one exists.
2. **Build the review website** — `npm run build --workspace @crit/host`, then copy `packages/host/dist-web/*` into `packages/cloudflare/assets/`.
3. **Create resources** — from `packages/cloudflare`, run `wrangler d1 create crit-control` and `wrangler r2 bucket create crit-artifacts`. Save the D1 `database_id`.
4. **Configure Wrangler** — in `packages/cloudflare/wrangler.jsonc`:
   - paste the real D1 `database_id`
   - keep the Durable Object migration block
   - **company hostname only:** add `routes` for the Crit hostname
   - **workers.dev only:** leave out `routes`
   - set `CRIT_DEPLOY_TOKEN` with `wrangler secret put` for production
5. **Deploy** — `npx wrangler deploy` from `packages/cloudflare`. Copy the live Crit URL.
6. **Access (optional)** — if the team needs named people, create an Access application for the Crit URL and include every author and reviewer. Skip this for an anonymous try-out install on `workers.dev`.
7. **Verify** — run the curl checks in the install doc against the chosen URL.
8. **Connect authors** — `npx crit login <crit-url>` then `npx crit share <canvas-id>`.

## After the installation works

| Next task | Skill |
|---|---|
| Register app previews from CI | [`crit-register-deployment`](../crit-register-deployment/SKILL.md) |
| Wire live app pages into Frames | [`install-crit-frame-bridge`](../install-crit-frame-bridge/SKILL.md) |
| Fix login or person binding | [`crit-identity`](../crit-identity/SKILL.md) |

Set repository secrets after deploy:

- `CRIT_INSTALLATION_URL` — the Crit URL from step 5, with no trailing path
- `CRIT_DEPLOY_TOKEN` — the same value set in Wrangler

## Done

- The Crit URL loads the review website.
- `crit login <crit-url>` succeeds for an author.
- Without Access, `/identity` returns an anonymous person.
- With Access, `/identity` returns the signed-in email.
- `/mcp` returns `404`.
- The user knows whether they are on a company hostname or `workers.dev`.
