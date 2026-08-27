# Retention

What Crit and Cloudflare retain automatically, and what operators should keep in long-term backup.

## Cloudflare platform defaults

| Data | Default retention | Operator action |
| --- | --- | --- |
| D1 `crit-control` Time Travel | 30 days (Workers Paid); 7 days (Workers Free) | Export SQL on a schedule for longer retention ([Backup](backup.md)) |
| Durable Object SQLite PITR | 30 days per `CanvasDurableObject` | Archive ledger JSON for canvases you must recover after 30 days |
| R2 `crit-artifacts` | Until explicitly deleted | No lifecycle rule in v1; artifacts are referenced forever by ledger JSON |
| Worker logs (dashboard) | Per Cloudflare account log retention settings | Forward to your SIEM if required for compliance |
| Access audit logs | Per Zero Trust log retention | Configure in Cloudflare dashboard |

Crit does not run background purge jobs on Canvas content or artifacts in v1.

## Crit data semantics

### D1 `canvas_shares`

Each row is a first-share receipt. The directory lists the latest row per `canvas_id`. Rows are not deleted by the Worker on unlink or rename; retention is operational (backups and D1 Time Travel).

### D1 `deployments`

One row per `(application_id, channel)`. `crit register-deployment` upserts `url`, `source_revision`, and optional `expires_at`. When `expires_at` is in the past, hosted resolve treats the Deployment as unbound; the row remains until overwritten or removed by an operator.

### Durable Object ledger

`accepted_changes` grows with every accepted change. `retry_reservations` holds in-flight submit state until accepted or rejected. There is no compaction in v1.

JSON rows are capped at 2 MiB per Durable Object SQL row (`DurableSqlRowLimitExceeded`). Extremely large single changes cannot be stored.

### R2 artifacts

Objects are immutable. New captures use new `artifactId` values. Old artifact objects remain in R2 even if Frames stop referencing them. Operators may delete unreferenced objects after verifying no projection or ledger row still names them.

## Recommended operator retention

| Backup type | Suggested cadence | Minimum keep |
| --- | --- | --- |
| D1 SQL export | Daily | 90 days |
| Ledger JSON per Canvas | Weekly, or after major releases | Match compliance needs |
| R2 full or incremental | Daily incremental | Until artifacts age out of all ledgers |
| D1 / DO PITR bookmarks | Before schema changes or bulk ops | 30 days (platform limit) |

Store backups encrypted at rest. Restrict access to the same group that can deploy the Installation.

## Local author data (out of Installation scope)

Authors keep a local SQLite replica and filesystem artifacts under `.crit/` on their machines. That state is not in the Installation backup. After share, the remote Durable Object ledger is authoritative for shared Canvases. Authors can rebuild local replicas with `crit sync` when the Installation is healthy.

## Related

- [Backup](backup.md)
- [Restore](restore.md)
