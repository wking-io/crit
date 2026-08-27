# Incident response

Triage and recovery for a customer-hosted Crit Installation. Use [Backup](backup.md) and [Restore](restore.md) once the immediate issue is contained.

## Severity guide

| Severity | Examples |
| --- | --- |
| S1 | Installation unreachable; widespread data loss; credential leak of `CRIT_DEPLOY_TOKEN` or Cloudflare API token |
| S2 | Hosted review broken for all users; sync failing for all authors; R2 or D1 unavailable |
| S3 | Single Canvas corrupt; one preview Deployment wrong; isolated 409 conflicts |

## First steps (all severities)

1. Note the time window and symptoms (HTTP status, `canvasId`, `artifactId`, user email).
2. Check Cloudflare status and account quotas.
3. Capture a D1 Time Travel bookmark before mutating production data:
   ```sh
   cd packages/cloudflare
   npx wrangler d1 time-travel info crit-control --remote
   ```
4. Open the Worker observability dashboard for 5xx spikes and uncaught exceptions.

## Symptom → cause → action

### `401` on `/canvas`, `/artifacts`, `/identity`, ledger routes

**Cause:** Missing or invalid Cloudflare Access session. The Worker requires `Cf-Access-Authenticated-User-Email`.

**Action:**

- Confirm the Access application still protects the Installation hostname.
- Confirm the user completed Access sign-in (hosted UI or service token).
- `POST /canvas` with a `person.email` that does not match the Access email returns `401` by design.

`POST /deployments` returning `401` is separate: check `Authorization: Bearer` matches `CRIT_DEPLOY_TOKEN` ([Key rotation](key-rotation.md)).

### `401` from `crit register-deployment`

**Cause:** Wrong or missing `CRIT_DEPLOY_TOKEN`, or empty Worker secret.

**Action:** Verify `env.CRIT_DEPLOY_TOKEN` is set (`wrangler secret list`). Rotate if leaked.

### `404` on `GET /canvas/{canvasId}` or changes

**Cause:** No ledger for that `canvasId` in the Durable Object (never shared, wrong id, or object wiped).

**Action:** Confirm `canvas_id` in D1 `canvas_shares`. If D1 has a row but the DO is empty, use Durable Object PITR ([Restore](restore.md#canvas-ledgers-durable-object-sqlite)) or restore from ledger archive.

### `404` on `GET /artifacts/{artifactId}`

**Cause:** Object missing from R2 or wrong `artifactId`.

**Action:** Restore the object from backup ([Restore](restore.md#r2-artifacts-crit-artifacts)). Confirm the Frame's digest query parameter matches the ledger.

### `409` `shareDigestMismatch` or `shareReceiptMismatch` on share

**Cause:** Retry of `crit share` with the same `shareId` but different projection digest or receipt fields.

**Action:** Expected when local projection changed under the same share id. Author must reconcile locally (new share or fix pending work). Not an Installation outage.

### `409` `changeIdReused`, `changeRejected`, `artifactDigestConflict`, `artifactCorrupt`

**Cause:** Protocol-level conflict or integrity check.

| Tag | Meaning | Action |
| --- | --- | --- |
| `changeIdReused` | Duplicate `changeId` at the authority | Author `crit sync`; inspect pending queue |
| `changeRejected` | Command batch rejected by policy/engine | Inspect failure in CLI; fix commands |
| `artifactDigestConflict` | Same `artifactId`, different bytes | Do not overwrite; pick new `artifactId` or restore correct bytes |
| `artifactCorrupt` | Bytes present but digest mismatch | Restore R2 object from backup |

### `500` on ledger or share

**Cause:** Durable Object internal error, including `DurableSqlRowLimitExceeded` when a stored JSON row exceeds 2 MiB.

**Action:** Identify the offending change size. Authors may need to split work or remove oversized payload from pending local state. For transient 500s, retry `crit sync`. Escalate with Worker logs and `canvasId`.

### Hosted UI loads but Frames show unavailable

**Cause:** Missing or expired Deployment in D1 (`deployments`), or preview origin down.

**Action:**

- Query `deployments` for the `application_id` and `channel` (default `review`).
- Check `expires_at` is null or in the future.
- Re-run preview CI `crit register-deployment` or fix the preview URL.

### Preview iframe blank or Access loop in Frame

**Cause:** Preview origin Access or `frame-ancestors` misconfiguration (Frame Bridge skill scope).

**Action:** Follow `skills/install-crit-frame-bridge/SKILL.md` for shared review preview setup. Crit Installation runbooks do not change preview CSP.

### Author `crit sync` stuck after Installation outage

**Cause:** Local replica behind remote cursor or missing artifacts.

**Action:** Restore Installation ([Restore](restore.md)). Author runs `crit sync` with network up. Remote conflicts remain visible in CLI per v1 policy.

## Credential leak playbooks

### `CRIT_DEPLOY_TOKEN` leaked

1. Rotate immediately ([Key rotation](key-rotation.md)).
2. Review `deployments` for unauthorized URLs.
3. No need to rotate Access unless the leak included session cookies (separate incident).

### Cloudflare API token leaked

1. Revoke token in dashboard.
2. Audit Worker versions, secrets, and D1/R2 changes in account audit log.
3. Issue new least-privilege token.

## Communication

- **Authors:** Installation URL, estimated recovery, whether `crit sync` is safe.
- **Reviewers:** Access sign-in status; hosted UI only (no local Crit install).
- **Compliance:** Backup timestamps and D1/DO bookmarks used for restore.

## Post-incident

- [ ] Root cause documented
- [ ] Backups verified after restore
- [ ] Rotated credentials recorded
- [ ] Verification steps in [Restore](restore.md#post-restore-verification) passed

## Related

- [Backup](backup.md)
- [Restore](restore.md)
- [Key rotation](key-rotation.md)
- [Testing program](../plans/001-cloudflare-native-v1/testing.md) — expected HTTP and workflow behavior
