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
npx @riff-refine/crit apply checkout-review '[{"_tag":"SetFrameStatus","id":"candidate","status":"approved"}]' --json
npx @riff-refine/crit create checkout-review --title "Checkout review" --json
npx @riff-refine/crit add checkout-review https://checkout.localhost --json
npx @riff-refine/crit snapshot checkout-review candidate --json
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
7. Add all relevant URLs in one `add` command.
8. Re-open the Canvas and report its URL, revision, and added Frames.

## Apply commands

Use Frame IDs returned by `open --json`. Submit related operations as one JSON
array to `apply`:

- `AddFrame`: `id`, `url`, `title`, `status`, and `provenance`.
- `UpdateFrame`: `id` plus non-empty `changes` containing URL, title, status,
  provenance, or `display`.
- `SetFrameStatus`: `id` and `status`.
- `MoveFrame`: `id`, `x`, and `y`.
- `ResizeFrame`: `id`, positive `width`, and positive `height`.
- `BringFrameToFront` and `SendFrameToBack`: `id`.
- `RemoveFrame`: `id`; this also removes Notes attached to the Frame.
- `AddNote`: `id`, `text`, `x`, and `y`, with optional `width` and `height`.
- `UpdateNote`: `id`, `expectedText`, and replacement `text`.
- `MoveNote`, `ResizeNote`, `AttachNote`, `DetachNote`, and `RemoveNote`.
- `BringNoteToFront` and `SendNoteToBack`: `id`.

## Editing rules

- Use Crit commands and interfaces; never edit `.crit/canvases/*.json`.
- Use one `apply` call for related `AddFrame`, `UpdateFrame`, `SetFrameStatus`,
  `MoveFrame`, `ResizeFrame`, `RemoveFrame`, and Note operations so they commit
  atomically.
- Preserve Frame identity. Do not remove and recreate a Frame merely to change
  its status, title, URL, position, or size.
- Treat manifest IDs as durable. Edit `crit.manifest.json` when a project-owned
  discovery declaration needs to change; sync never deletes absent Frames.
- Attach Notes to their Frame when they should move together; detaching preserves
  their Canvas position.
- Ask before replacing or discarding user-authored Canvas content.
- Use `snapshot <canvas> <frame> --json` when the user asks to preserve the
  current rendered version. Keep the live Frame; the command adds a separate
  archived Frame and immutable artifact.

## Setup and diagnosis

Run `npx @riff-refine/crit init` when Crit is not configured. The initializer
installs the Vite adapter, React surface, route where supported, ignore rule,
default manifest, and this project skill. If discovery fails, verify that
`GET /.well-known/crit.json` returns a manifest. If the editor cannot load,
verify the Vite plugin is enabled and that `GET /__crit/api/canvases/<id>`
returns a Canvas Document.

Snapshot capture requires the local Vite plugin and a reachable HTTP(S) Frame.
Artifacts live in `.crit/snapshots` and are served at
`/__crit/snapshots/<artifact-id>`; do not edit or replace them directly.

Crit V1 is local-only. Do not expose its local HTTP endpoints as a remote
collaboration service.
