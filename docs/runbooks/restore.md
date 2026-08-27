# Restore

Restore order matters: D1 directory and deployments first, then Canvas ledgers, then R2 artifacts. Hosted review resolves application-route Frames from D1 `deployments`; artifact Frames need matching R2 bytes and digests.

Test restores in a separate Cloudflare account or against a staging Worker before touching production.

## D1 control plane

### Full SQL import

Import a previously exported `crit-control` backup:

```sh
cd packages/cloudflare
npx wrangler d1 execute crit-control --remote --file=./backup/crit-control-YYYYMMDD.sql
```

If import fails on foreign-key ordering, prepend `PRAGMA foreign_keys=OFF;` to the SQL file (see [Cloudflare D1 import guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/)).

`deployments` and `canvas_shares` use `CREATE TABLE IF NOT EXISTS` at runtime. A restore file should contain the table definitions and rows from export.

### Point-in-time restore (≤30 days)

When export files are missing or corrupt, use D1 Time Travel:

```sh
# By timestamp (RFC3339 or Unix seconds)
npx wrangler d1 time-travel restore crit-control --remote --timestamp="2026-08-25T12:00:00Z"

# Or by bookmark saved from `wrangler d1 time-travel info`
npx wrangler d1 time-travel restore crit-control --remote --bookmark="BOOKMARK_FROM_INFO"
```

Time Travel restores the entire D1 database. It does not restore Durable Object or R2 data.

## Canvas ledgers (Durable Object SQLite)

### Point-in-time restore (≤30 days, per Canvas)

Crit does not expose ledger restore on the Worker. Recovery uses Cloudflare's Durable Object PITR API on each `CanvasDurableObject` instance:

1. Resolve `canvasId` values from restored D1 (`SELECT DISTINCT canvas_id FROM canvas_shares`) or from your ledger archive.
2. For each Canvas, obtain a storage bookmark for the target time (`getBookmarkForTime`) and call `onNextSessionRestoreBookmark`, then restart the object (`abort`). This is done from code that holds the `CANVASES` namespace binding—the same binding the Installation Worker uses.

See [Cloudflare Durable Object PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#point-in-time-recovery-pitr). PITR is not available in local `wrangler dev`.

Undo a mistaken PITR by restoring to the bookmark returned immediately before the recovery.

### Ledger JSON archives

v1 has no bulk ledger import API. Archived `GET /canvas/.../changes` JSON is for audit and disaster analysis, not automated replay into a fresh Durable Object. Prefer Durable Object PITR inside the 30-day window. Outside that window, contact your Crit support channel with the archive.

## R2 artifacts (`crit-artifacts`)

Upload each backed-up object under its `artifactId` key:

```sh
npx wrangler r2 object put crit-artifacts/artifact_example --file=./backup/artifacts/artifact_example
```

R2 puts are create-only for conflicting content: the Worker uses `onlyIf: { etagDoesNotMatch: "*" }` on first write. If an object already exists with the same bytes, leave it. If a key exists with different bytes, investigate before overwriting—ledgers treat digest mismatch as corruption (`artifactCorrupt` / `artifactDigestConflict`).

## Worker and static assets

Redeploy the Installation Worker and bundled hosted UI from the published Crit package:

```sh
cd packages/cloudflare
npx wrangler deploy
```

This restores Worker code and static assets. It does not replace D1, Durable Object, or R2 customer data.

## Post-restore verification

Run these checks against the Installation hostname with a valid Access session:

1. `GET /identity` returns the expected email.
2. `GET /canvas` lists the expected shared canvases.
3. `GET /canvas/{canvasId}` returns a projection matching the pre-incident digest when known.
4. Open a hosted review Canvas in the browser; Frames with `applicationRoute` resolve via `POST /representations/application-route`.
5. Open an artifact Frame; `GET /artifacts/{artifactId}?digest=sha256:…` returns `200` with matching bytes.
6. From an author's machine, `crit sync` pulls without `cursorNotFound` or missing artifact errors.

For deployment registration after restore:

```sh
CRIT_INSTALLATION_URL=https://crit.example CRIT_DEPLOY_TOKEN=… \
  npx crit register-deployment --url "https://preview.example/" --revision "restore-check"
```

Expect `200` from `POST /deployments`.

## Related

- [Backup](backup.md)
- [Incident response](incident-response.md)
