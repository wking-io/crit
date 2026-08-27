# Crit Installation operations runbooks

Operator guides for a customer-hosted Crit Installation on Cloudflare. These runbooks describe what the Worker actually stores today and how to back it up, restore it, retain it, rotate secrets, and respond to incidents.

Installation setup (Wrangler, Access, first deploy) is documented separately. These runbooks assume the Installation is already running.

## What an Installation stores

Crit splits durable state across three Cloudflare bindings configured in `packages/cloudflare/wrangler.jsonc`:

| Store | Binding | Name in Wrangler | What it holds |
| --- | --- | --- | --- |
| D1 | `CONTROL` | `crit-control` | Control-plane rows: shared Canvas directory (`canvas_shares`) and preview Deployment registrations (`deployments`). No canonical Canvas ledger. |
| Durable Object SQLite | `CANVASES` | `CanvasDurableObject` | One SQLite database per shared Canvas (`canvases`, `accepted_changes`, `retry_reservations`). Canvas identity is the Durable Object name (`idFromName(canvasId)`). |
| R2 | `ARTIFACTS` | `crit-artifacts` | Immutable artifact bytes. Object key is the `artifactId` (for example `artifact_capture`). |

Identity is Cloudflare Access on the Installation hostname. Crit reads `Cf-Access-Authenticated-User-Email` at the Worker boundary. v1 does not store Person accounts in D1.

The only Crit-managed Installation secret is `CRIT_DEPLOY_TOKEN`, used by `POST /deployments` for `crit register-deployment`.

## Runbooks

- [Backup](backup.md) — export D1, Canvas ledgers, and R2 artifacts
- [Restore](restore.md) — recover each store and verify the Installation
- [Retention](retention.md) — what expires automatically and what operators should keep
- [Key rotation](key-rotation.md) — rotate `CRIT_DEPLOY_TOKEN` and related Cloudflare credentials
- [Incident response](incident-response.md) — triage symptoms, HTTP status codes, and recovery paths

## Worker routes (reference)

All routes below are served by the Installation Worker unless noted.

| Route | Methods | Auth | Purpose |
| --- | --- | --- | --- |
| `/` | GET | Access (browser) | Hosted review UI shell |
| `/canvas` | GET, POST | Access | Canvas directory; first share |
| `/canvas/:canvasId` | GET | Access | Open Canvas authority view |
| `/canvas/:canvasId/changes` | GET, POST | Access | Pull accepted changes; submit a change |
| `/artifacts/:artifactId` | GET, PUT | Access | Read or store immutable artifact bytes |
| `/deployments` | POST | `Authorization: Bearer $CRIT_DEPLOY_TOKEN` | Upsert preview Deployment registration |
| `/identity` | GET | Access | Return Access-authenticated email |
| `/representations/application-route` | POST | Access | Resolve an application-route Frame to the registered preview |

Paths and wire shapes come from `@crit/protocol`. Crit v1 does not expose `/mcp`, agent OAuth, or operator backup APIs on the Worker.

## Wrangler context

Run Wrangler commands from `packages/cloudflare` (or pass `--config packages/cloudflare/wrangler.jsonc`). Replace account-specific IDs in `wrangler.jsonc` with the values from your Installation dashboard before operating on production.
