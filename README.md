# Crit

Crit is a local-first React canvas for arranging and assessing live web
iterations. It uses one tldraw Store as the live document, Effect v4 for typed
runtime seams, single-flight autosave, and browser draft recovery.

Initialize Crit in a Vite + React project:

```sh
npx @riff-refine/crit init
```

The initializer installs the package, updates Vite without replacing existing
plugins, creates the React surface, adds `.crit/` to `.gitignore`, and installs
the project agent skill. It also creates `crit.manifest.json` with a default
Canvas containing the host application. React Router framework projects receive
a registered `/crit/:canvasId?` route. Other routers get an explicit component
mount instruction rather than a guessed mutation.

Describe review Canvases without hard-coding the running origin:

```json
{
  "schemaVersion": 1,
  "id": "storefront",
  "canvases": [
    {
      "id": "checkout-review",
      "title": "Checkout review",
      "frames": [
        {
          "id": "candidate",
          "url": "/checkout",
          "title": "Checkout candidate",
          "status": "in-progress"
        }
      ]
    }
  ]
}
```

The Vite adapter publishes the resolved document at
`/.well-known/crit.json`. Opening `/crit/checkout-review` reconciles its Frames
before the editor loads. Agents can perform the same idempotent reconciliation
from a discovered app origin:

```sh
npx @riff-refine/crit sync --from https://storefront.localhost --json
```

Agents can atomically apply every semantic Frame operation with optimistic
revision checking:

```sh
npx @riff-refine/crit apply checkout-review \
  '[{"_tag":"SetFrameStatus","id":"candidate","status":"approved"}]' \
  --expected-revision 3 --json
```

The command accepts arrays containing `AddFrame`, `UpdateFrame`,
`SetFrameStatus`, `MoveFrame`, `ResizeFrame`, and `RemoveFrame`. It returns the
new revision and complete Frame summaries for follow-up work.

Manifest reconciliation preserves Frame identity and never removes Frames or
their annotations implicitly. New Frame status defaults to `in-progress`;
omitted status, `display`, and `geometry` fields do not overwrite later review
changes. Declare those fields when the manifest should continue to own them.

Add the Vite plugin. It owns the local HTTP adapter and stores Canvas Documents
under `.crit/canvases`:

```ts
// vite.config.ts
import { defineConfig } from "vite"
import { crit } from "@riff-refine/crit/vite"

export default defineConfig({
  plugins: [crit()]
})
```

The adapter runs only during Vite serve/preview. It can also be gated explicitly
with `crit({ enabled: mode !== "production" })` from a functional Vite config.
Use `manifest: false`, a custom manifest filename, or `manifestPath` to configure
discovery publication.

The React entry point then owns the editor lifecycle and required tldraw styles:

```tsx
import { Crit } from "@riff-refine/crit"

export function ReviewCanvas() {
  return <Crit canvasId="homepage" />
}
```

With the pointer tool selected, each Frame header includes a native status
selector for marking it in progress, approved, or changes requested. The change
updates the tldraw record directly and follows the normal autosave path.

The Vite adapter creates a missing Canvas on first load. Pass
`crit({ createIfMissing: false })` when creation must remain explicit.

For non-production Cloudflare deployments, use the same HTTP contract with a D1
binding:

```ts
// worker.ts
import { makeCritCloudflareHandler } from "@riff-refine/crit/cloudflare"
import app from "./app"

const crit = makeCritCloudflareHandler({ initializeSchema: false })

export default {
  async fetch(request, env, context) {
    const response = await crit(request, {
      database: env.CRIT_DB,
      enabled: env.CRIT_ENABLED === "true"
    })
    return response ?? app.fetch(request, env, context)
  }
} satisfies ExportedHandler<Env>
```

`Env` and `ExportedHandler` should come from `wrangler types`; Crit accepts the
generated D1 binding structurally and does not add Cloudflare runtime types to
other consumers. Add a `CRIT_DB` D1 binding and a `CRIT_ENABLED` variable to
`wrangler.jsonc`, setting the variable to `"false"` in production:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "app-preview",
  "main": "worker.ts",
  "compatibility_date": "2026-08-08",
  "compatibility_flags": ["nodejs_compat"],
  "vars": { "CRIT_ENABLED": "true" },
  "d1_databases": [
    {
      "binding": "CRIT_DB",
      "database_name": "crit-preview",
      "database_id": "<DATABASE_ID>",
      "migrations_dir": "migrations"
    }
  ]
}
```

Copy the packaged migration into the configured directory, then apply it and
regenerate binding types:

```sh
cp node_modules/@riff-refine/crit/migrations/0001_crit_canvases.sql migrations/
npx wrangler d1 migrations apply crit-preview --local
npx wrangler d1 migrations apply crit-preview --remote
npx wrangler types
```

The handler returns `null` for disabled and non-Crit requests so the existing
application remains in control. Schema initialization is enabled by default for
zero-setup preview use and cached once per D1 binding; committed Wrangler
migrations plus `initializeSchema: false` are preferred for repeatable
deployments.

`client` remains the transport seam. Pass a custom `CritClientShape` to target
another HTTP runtime without changing editor ownership. Draft recovery
uses IndexedDB by default and a tab-stable session ID; pass `draftJournal={false}`
to disable it or provide another journal implementation.

Open editors check for newer revisions every two seconds. A clean Session adopts
external agent changes into the existing tldraw Store; local dirty or in-flight
work is never overwritten. Set `refreshInterval={false}` to disable polling or
pass another Effect duration to tune it. `onSession` also exposes `refresh()`
for explicit checks.

Headless consumers can import the platform-neutral engine without React:

```ts
import { Canvas } from "@riff-refine/crit/core"
```

Use `--skip-install` when dependency installation is managed separately, and
`--json` for machine-readable initialization results.

Before publishing, run `npm run verify`. It typechecks and tests the source,
then packs Crit and installs the tarball into an isolated consumer. The smoke
check builds the React entry point, imports every runtime adapter, verifies the
packaged migration and skill, and exercises the installed CLI. `npm publish`
runs the same gate automatically.
