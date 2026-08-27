# Key rotation

Crit v1 Installation secrets and the Cloudflare credentials that touch them.

## `CRIT_DEPLOY_TOKEN`

**Purpose:** Authenticates `POST /deployments` for `crit register-deployment` (preview CI).

**Stored as:** Worker secret on the Installation (`CRIT_DEPLOY_TOKEN`). Referenced in application CI as `CRIT_DEPLOY_TOKEN` (see `skills/crit-register-deployment/SKILL.md`).

**Rotation:**

1. Generate a new random token (at least 32 bytes, URL-safe).
2. Set the Worker secret:
   ```sh
   cd packages/cloudflare
   npx wrangler secret put CRIT_DEPLOY_TOKEN
   ```
3. Update every CI secret named `CRIT_DEPLOY_TOKEN` in application repositories that call `crit register-deployment`.
4. Trigger a test registration:
   ```sh
   CRIT_INSTALLATION_URL=https://crit.example CRIT_DEPLOY_TOKEN=<new> \
     npx crit register-deployment --url "https://preview.example/" --revision "rotation-test"
   ```
5. Confirm `200` from `POST /deployments`. Revoke the old token (it stops working as soon as the secret is replaced).

**Compromise:** Rotate immediately. The token only gates Deployment registration, not Canvas read/write or artifact access. Review recent `deployments` rows for unexpected URLs.

## Cloudflare API token (Wrangler / CI deploy)

**Purpose:** Deploy the Worker, export D1, and manage R2.

**Rotation:** Create a new API token in the Cloudflare dashboard with least privilege (Workers Scripts, D1, R2 for the Installation account). Update operator and CI storage. Revoke the old token after a successful `wrangler deploy` and backup job.

This token is not read by the running Installation Worker.

## `CRIT_INSTALLATION_URL`

**Purpose:** CLI and CI target for `crit share`, `crit login`, and `crit register-deployment`.

**Rotation:** Not a secret. When the Installation hostname changes, update CI secrets and author `crit login` / project config to the new URL. No Worker secret change required unless you redeploy on a new zone.

## Cloudflare Access

**Purpose:** Identity for hosted review, ledger, and artifact routes. The Worker trusts `Cf-Access-Authenticated-User-Email` injected by Access.

**Rotation:** Managed in Cloudflare Zero Trust (identity provider certificates, SAML/OIDC client secrets, service tokens). Rotating the IdP or Access application does not require redeploying Crit. After IdP rotation, verify `GET /identity` and browser sign-in to the hosted UI.

Access does not gate `POST /deployments`; that route uses `CRIT_DEPLOY_TOKEN` only.

## What Crit does not rotate in v1

- No per-user API keys in D1
- No OAuth agent grants or MCP tokens
- No automatic secret versioning inside the Worker

## Related

- [Incident response](incident-response.md) — token leak playbook
- [README](README.md) — route auth matrix
