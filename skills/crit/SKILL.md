---
name: crit
description: Creates and updates Crit canvases containing live web iteration frames. Use when collecting implementation variants, discovering review URLs, arranging iterations for visual review, or when the user mentions Crit canvases or frames.
---

# Crit Canvas Workflows

## Quick start

Run commands from the project root. Prefer JSON output when another tool will
consume the result.

```sh
npx @riff-refine/crit list --json
npx @riff-refine/crit sync --from https://app.localhost --json
npx @riff-refine/crit create checkout-review --title "Checkout review" --json
npx @riff-refine/crit add checkout-review https://checkout.localhost --json
```

Open `/crit/checkout-review` in the host application after adding frames.

## Build a review canvas

1. Run `list --json` and reuse the requested Canvas when it already exists.
2. Discover running app origins from active dev-server output, worktree tooling,
   and local proxy state. Read `/.well-known/crit.json` on each origin.
3. Prefer `sync --from <origin> --json` when a manifest is available. It creates
   declared Canvases and reconciles Frames by stable identity without pruning.
4. Otherwise keep only HTTP or HTTPS URLs that represent renderable iterations.
5. Create the Canvas when needed, using a stable kebab-case ID.
6. Run `open <canvas> --json` to read its current revision and Frames.
7. Add all relevant URLs in one `add` command. Pass `--expected-revision` when
   coordinating with another writer.
8. Re-open the Canvas and report its URL, revision, and added Frames.

## Editing rules

- Use Crit commands and interfaces; never edit `.crit/canvases/*.json`.
- Treat Canvas revision conflicts as a signal to re-open, reconcile, and retry.
- Preserve Frame identity. Do not remove and recreate a Frame merely to change
  its status, title, URL, position, or size.
- Treat manifest IDs as durable. Edit `crit.manifest.json` when a project-owned
  discovery declaration needs to change; sync never deletes absent Frames.
- Keep annotations parented to their Frame when they should move together.
- Do not create Asset records; Crit V1 supports live Frames and annotations.
- Ask before replacing or discarding user-authored Canvas content.

## Setup and diagnosis

Run `npx @riff-refine/crit init` when Crit is not configured. The initializer
installs the Vite adapter, React surface, route where supported, ignore rule,
default manifest, and this project skill. If discovery fails, verify that
`GET /.well-known/crit.json` returns a manifest. If the editor cannot load,
verify the Vite plugin is enabled and that `GET /__crit/api/canvases/<id>`
returns a Canvas Document.
