# v1 todo

[Back to the overview](overview.md)

Authors build Frames locally. After share, teammates review in the hosted UI. They do not install Crit. Agents stay on the author's machine. v1 is Frames only.

This file is the current inventory. Phase docs own the prove. [Decision record](decision-record.md) owns why.

## Next

- [ ] Snapshot a live Frame into a new artifact Frame. Specific action, not a generic representation change. Runtime `capture` exists. There is no product action. Plan: [phase 5](phase-05-review-ui.md).

## Remaining

### Local review

Plan: [phase 5](phase-05-review-ui.md), [phase 3](phase-03-local-daemon-and-cli.md), [phase 4](phase-04-representations-and-bridge.md).
- [ ] Presence of people and local Agent runs.
- [ ] Person vs Agent authorship in the UI. Pending changes show a local display name. Agent work must not look like the Person who ran the Agent did it.
- [ ] Shared pending, conflict, unavailable, and offline states. Local pending/conflict/sync exists.
- [ ] Inspect a Representation. `RepresentationRuntime` in the overview still names it. Nothing implements it.
- [ ] Frame Bridge capability negotiation, route/revision reporting, highlighting, authorized inspection.
- [ ] Bridge off in ordinary production. Opt-in only on shared review previews.
- [ ] Same Frame resolves to localhost for the author and a registered preview for a teammate.
- [ ] Shared Deployment bindings.
- [ ] Host UI that can open a Canvas other than `canvas_local`. CLI already can.

### Share and hosted review

Plan: [phase 6](phase-06-cloudflare-platform.md), [phase 7](phase-07-sync-and-sharing.md), [phase 8](phase-08-hosted-review.md).

- [ ] `crit login` and `crit share`.
- [ ] Push/pull by change ID and cursor against a remote authority.
- [ ] First share with share/import IDs and a projection digest.
- [ ] Two author replicas edit offline and converge.
- [ ] Recoverable remote conflicts that keep dependent pending work. Local replica policy exists.
- [ ] Worker, static assets, Access, D1, one SQLite Durable Object per Canvas, R2 artifacts. `packages/cloudflare` is empty.
- [ ] Hosted review UI served from the Worker.
- [ ] Teammate signs in with Access, views Frames and shared previews, and sets review status. No Crit install.
- [ ] Author's local replica receives the reviewer's accepted changes.

### Agents

Local only. Plan: [decision record](decision-record.md), [ADR 0001](../../adr/0001-hosted-review-no-mcp.md).

- [ ] Stamp and show Agent as author, plus the local Person who ran it, execution, and optional harness/model/session/task. Types exist.

### Release

Plan: [phase 9](phase-09-release.md), [testing](testing.md).

- [ ] Documented customer Cloudflare install.
- [ ] Backup, restore, retention, key rotation, incident runbooks.
- [ ] Protocol negotiation with actionable client errors.
- [ ] Published SDK for domain, client, React, Frame Bridge, and testing.
- [ ] Alpha removed from the release artifact.
- [ ] `/mcp` and agent OAuth routes stay absent.

## Done

Local Frames authoring on one machine.

- `crit init`, `crit dev`, `crit status`, `create`, `open`, `layout`, `add-frame`
- Project-local agent skill
- Named Canvas, rename
- Add, title, move, resize, stack, and remove Frames
- Review status: in-progress, ready-for-review, changes-requested, approved
- Atomic command batches with recoverable local conflicts
- Camera, pan, zoom, saved camera and selection
- Align, distribute, arrange grid, breakpoint presets
- Offscreen Frames pause themselves, fullscreen, open `web-url` in a new tab, copy Frame ID
- `application-route`, `web-url`, and digest-bound `artifact` in domain, CLI, and local resolve
- Local Application binding from the manifest and `--application-origin`
- Unavailable render for unbound app or missing/corrupt artifact
- Frame Bridge input relay
- Local SQLite authority, replica, restart-safe pending work
- Person and Agent as domain Actors
- Review UI no longer adds Frames
- Contextual help and keyboard shortcuts from the review action table

## Out of v1

Do not pick these up.

- Notes and Comments
- Undo and redo
- Fit-page display mode
- Add Frame from the review UI
- Generic representation change (`set-frame-representation` as a product action)
- Workspace commands, switch UX, or multi-workspace selection. `WorkspaceId` stays.
- Remote MCP, Code Mode, OAuth agent grants
- Reviewer installs Crit or runs a local daemon
- Organization tenancy
- CRDTs, cross-Canvas transactions, automatic tunnels, unrestricted proxies
- D1 as the Canvas ledger, Queue in the commit path
- Importing or reading alpha Canvas state
