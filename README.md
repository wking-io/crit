# Crit

Crit is a local-first collaborative review canvas for live web applications.

Authors use the Crit UI, CLI, and local agents to arrange live pages, compare responsive Frames, and preserve captures. After share, teammates review in the hosted UI. They do not install Crit. v1 is Frames only.

## Rewrite status

Crit is being rewritten around the target v1 architecture. The current source tree contains the local-only alpha and remains a behavior reference while the rewrite is built. New architecture documents describe the replacement system. They are not a claim that every target command is implemented on the current branch.

The rewrite does not preserve the alpha's runtime APIs, JSON Canvas format, IndexedDB state, Git-derived Canvas ownership, URL-based Frame identity, or Vite-owned persistence.

## Target developer workflow

Install Crit in a web project:

```sh
npm install --save-dev @riff-refine/crit
npx crit init
npm run dev
```

`crit init` installs the local daemon integration, manifest version 2, project skills, and a development-only Frame Bridge configuration. Local authoring works without a remote account.

Share a Canvas when the team needs it:

```sh
npx crit login https://crit.acme.internal
npx crit share checkout-redesign
```

Crit selects the remembered accessible Workspace. Otherwise it selects the Installation's default Workspace. Run Workspace commands only to switch.

## Target review workflow

Local agents connect to `crit dev` while the author is building. After share, review is human-led.

A teammate opens the hosted review UI and signs in with Cloudflare Access. They do not install Crit. Crit has no MCP server and no OAuth agent grants.

Accepted local Agent work identifies the Agent as author. Crit also records the Person who ran that Agent and optional reported harness, model, session, and task metadata.

## Target Cloudflare deployment

Crit runs in the customer's Cloudflare account:

- Workers serve the API, hosted review UI, and Static Assets.
- Cloudflare Access supplies company identity.
- D1 stores Installation, Workspace, membership, Application, and Deployment data.
- One SQLite Durable Object owns each shared Canvas Ledger.
- R2 stores immutable artifacts.

One Installation is one tenant. Crit v1 has no Organization model.

## Live pages

A Frame stores a logical Representation, not an environment URL. An Application Route can resolve to localhost for a developer and a registered preview for a teammate. An immutable Artifact resolves to the same digest everywhere.

The Frame Bridge is on in local development. Ordinary production builds and previews keep it off. An explicit shared review preview can opt in.

## Read the design

- [`ARCHITECTURE.md`](ARCHITECTURE.md) defines the target system.
- [`CONTEXT.md`](CONTEXT.md) defines Crit's domain language.
- [`docs/plans/001-cloudflare-native-v1`](docs/plans/001-cloudflare-native-v1/overview.md) contains the clean-rewrite implementation plan.
- [`docs/plans/001-cloudflare-native-v1/testing.md`](docs/plans/001-cloudflare-native-v1/testing.md) defines the verification program.

Historical issue, research, and migration documents describe the alpha or prior investigations. They do not override the target architecture.

## Development baseline

The current repository still uses these checks:

```sh
npm run lint
npm run typecheck
npm test
npm run verify
```

The rewrite adds shared conformance suites for the local SQLite authority and Canvas Durable Object, plus end-to-end local, synchronization, Representation, installation, and hosted-review proofs.
