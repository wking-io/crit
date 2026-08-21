# Crit

Crit is a local-first collaborative review canvas for live web applications.

People use the Crit UI to arrange live pages, compare responsive Frames, leave Notes and comments, preserve captures, and review changes together. Agents can create and edit the same content through local tools or an OAuth Code Mode MCP server.

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

## Target agent workflow

Local agents connect to `crit dev`. Shared agents connect to:

```text
https://mcp.crit.acme.internal/mcp
```

The remote MCP server uses OAuth and exposes two Code Mode tools:

- `search` discovers the relevant typed Crit operations.
- `execute` runs code against a capability-limited `crit` client.

Accepted work identifies the Agent as author. Crit also records the Person who delegated access and optional reported harness, model, session, and task metadata.

## Target Cloudflare deployment

Crit runs in the customer's Cloudflare account:

- Workers serve the API, OAuth routes, MCP routing, and Static Assets.
- Cloudflare Access supplies company identity.
- D1 stores Installation, Workspace, membership, grant, Application, and Deployment data.
- One SQLite Durable Object owns each shared Canvas Ledger.
- R2 stores immutable artifacts and retained Agent execution records.

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

The rewrite adds shared conformance suites for the local SQLite authority and Canvas Durable Object, plus end-to-end local, synchronization, Representation, installation, and OAuth MCP proofs.
