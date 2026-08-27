# Backup

Back up all three durable stores: D1 control data, per-Canvas Durable Object ledgers, and R2 artifacts. A complete Installation backup needs all three. D1 alone is not enough to reconstruct shared Canvas content.

## Before you start

- Confirm the target environment (`--remote` for production).
- Record the Installation hostname, D1 database name (`crit-control`), R2 bucket name (`crit-artifacts`), and Worker name (`crit-cloudflare`).
- Store backups outside the Cloudflare account (encrypted object storage, vault, or offline archive).

## 1. D1 control plane (`crit-control`)

D1 holds `canvas_shares` and `deployments`. Export the full database:

```sh
cd packages/cloudflare
npx wrangler d1 export crit-control --remote --output "./backup/crit-control-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

`canvas_shares` columns: `share_id`, `import_id`, `canvas_id`, `workspace_id`, `person_id`, `projection_digest`, `title`.

`deployments` columns: `application_id`, `channel`, `deployment_id`, `url`, `source_revision`, `expires_at`.

### D1 point-in-time bookmark (short-term)

D1 Time Travel is always on. Before a risky migration or bulk delete, capture a bookmark:

```sh
npx wrangler d1 time-travel info crit-control --remote
```

Save the printed bookmark or timestamp. See [Restore](restore.md#d1-control-plane) for recovery.

## 2. Canvas ledgers (Durable Object SQLite)

Each shared Canvas has its own `CanvasDurableObject` instance. The object name is the `canvasId`. Tables inside each object:

- `canvases` — projection and cursors
- `accepted_changes` — canonical accepted change log
- `retry_reservations` — in-flight submit retries

Crit does not ship an operator export route on the Worker. Use one of these approaches.

### A. Ledger export over existing HTTP (long-term archive)

Use the Installation's public ledger API with a valid Access session (service token or operator browser session). Paths are defined in `@crit/protocol`:

1. List shared canvases: `GET /canvas` → `canvas-directory` wire with `canvasId` values.
2. For each `canvasId`:
   - `GET /canvas/{canvasId}` → authority view and current projection.
   - Page accepted history: `GET /canvas/{canvasId}/changes?after={cursor}&limit=1000` until `hasMore` is false. Start with `after` omitted or empty for genesis.

Store the JSON responses. They are sufficient to audit content and to understand what R2 artifact IDs and digests the projection references.

### B. Durable Object PITR bookmark (short-term)

SQLite-backed Durable Objects keep 30 days of point-in-time recovery history. Crit does not expose PITR on the Worker; recovery uses Cloudflare's Durable Object storage API on each `CanvasDurableObject` stub. See [Restore](restore.md#canvas-ledgers-durable-object-sqlite).

For archival beyond 30 days, use ledger export (A) plus R2 backup (section 3).

## 3. R2 artifacts (`crit-artifacts`)

Artifact bytes are immutable. R2 object keys are `artifactId` strings (for example `artifact_capture`). The ledger and projection reference `artifactId` and `sha256:` digests.

### List and download

Wrangler supports single-object get/put. For a full bucket copy, use the Cloudflare R2 API, [rclone](https://rclone.org), or AWS CLI with an R2 S3 endpoint. Example with Wrangler for one object:

```sh
npx wrangler r2 object get crit-artifacts/artifact_example --file ./backup/artifacts/artifact_example
```

To discover keys, list from the R2 API (paginate with `cursor`) or derive `artifactId` values from backed-up ledger JSON.

### Verify digests after download

Artifact GET on the Installation requires `?digest=sha256:…` matching the stored content. After restore or spot-check, compare the downloaded bytes to the digest recorded in the Canvas projection or `accepted_changes` JSON.

## 4. Secrets inventory (not in D1)

Record where these live; they are not included in D1 export:

| Secret | Where stored | Used for |
| --- | --- | --- |
| `CRIT_DEPLOY_TOKEN` | Worker secret (`wrangler secret put`) | `POST /deployments` |
| Cloudflare API token | CI / operator vault | `wrangler deploy`, D1/R2 operations |
| Access identity provider | Cloudflare Zero Trust dashboard | Hosted review sign-in |
| `CRIT_INSTALLATION_URL` | Application CI secrets | `crit share`, `crit register-deployment` |

## Backup checklist

- [ ] D1 SQL export (`crit-control`)
- [ ] D1 Time Travel bookmark noted (optional, pre-change)
- [ ] Ledger JSON per `canvasId` from `/canvas` and `/canvas/.../changes`
- [ ] R2 objects for every `artifactId` referenced by those ledgers
- [ ] Secrets inventory updated in your password manager

## Related

- [Restore](restore.md)
- [Retention](retention.md)
