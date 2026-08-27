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

`crit login` reconciles the local Person with the Access-authenticated Person. Share uses that bind.

v1 uses the Installation's implicit default Workspace. It does not expose workspace switching.

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

To deploy the Installation Worker in your account, follow [`docs/install/cloudflare.md`](docs/install/cloudflare.md).

## Live pages

A Frame stores a logical Representation, not an environment URL. An Application Route can resolve to localhost for a developer and a registered preview for a teammate. An immutable Artifact resolves to the same digest everywhere.

The Frame Bridge reports the live page route. It is on in local development. Ordinary production builds and previews keep it off. An explicit shared review preview can opt in.

## Register previews from CI

`crit init` writes `.agents/skills/crit-register-deployment/SKILL.md`. Ask an agent in the application repo to add Crit preview registration to GitHub Actions. The skill reads `crit.manifest.json` and `crit register-deployment --help`, then edits the deploy workflow.

The Frame stays `{ applicationId, route }`. Each green preview deploy replaces the Installation's review Deployment URL.

Set these repository secrets:

- `CRIT_INSTALLATION_URL` such as `https://crit.acme.internal`
- `CRIT_DEPLOY_TOKEN` matching the Installation Worker secret `CRIT_DEPLOY_TOKEN`

```yaml
name: preview

on:
  push:
    branches: [main]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        id: deploy
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages deploy dist --project-name my-app
      - name: Register the preview with Crit
        env:
          CRIT_INSTALLATION_URL: ${{ secrets.CRIT_INSTALLATION_URL }}
          CRIT_DEPLOY_TOKEN: ${{ secrets.CRIT_DEPLOY_TOKEN }}
          PREVIEW_URL: ${{ steps.deploy.outputs.deployment-url }}
        run: npx crit register-deployment --url "${PREVIEW_URL%/}/" --revision "${{ github.sha }}"
```

`--url` must be a public HTTP origin with a trailing slash. `applicationId` comes from `crit.manifest.json`. `--channel` defaults to `review`. The token is an Installation machine secret. It is not an Access user email.

## Read the design

- [`ARCHITECTURE.md`](ARCHITECTURE.md) defines the target system.
- [`CONTEXT.md`](CONTEXT.md) defines Crit's domain language.
- [`docs/plans/001-cloudflare-native-v1`](docs/plans/001-cloudflare-native-v1/overview.md) contains the clean-rewrite implementation plan.
- [`docs/plans/001-cloudflare-native-v1/v1-todo.md`](docs/plans/001-cloudflare-native-v1/v1-todo.md) is the current done and remaining inventory.
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
