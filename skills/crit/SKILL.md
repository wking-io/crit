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
npx @riff-refine/crit identity --json
npx @riff-refine/crit sync --from https://app.localhost --json
npx @riff-refine/crit apply checkout-review '[{"_tag":"SetFrameStatus","id":"candidate","status":"approved"}]' --json
npx @riff-refine/crit create checkout-review --title "Checkout review" --json
npx @riff-refine/crit add checkout-review https://checkout.localhost --json
npx @riff-refine/crit snapshot checkout-review candidate --json
npx @riff-refine/crit activity checkout-review --id <run-id> --harness <harness> --detail "Refining checkout" --json
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
- `RemoveFrame`: `id`; this detaches and preserves Notes attached to the Frame.
- `AddNote`: `id`, `text`, `author`, `x`, `y`, positive `width`, and positive `height`
  (all required; 280×160 is a reasonable default size).
- `EditNote`: `id`, the Note Author's `actorId`, `expectedText`, and replacement
  `text`.
- `MoveNote`, `ResizeNote`, `AttachNote`, and `DetachNote` arrange any Note.
- `RemoveNote`: `id` and the Note Author's `actorId`.
- `BringNoteToFront` and `SendNoteToBack`: `id`.
- `AddCommentThread`: `id`, `frameId`, an `anchor`, and an opening message.
- `ReplyToCommentThread`: thread `id` and a flat `reply` message.
- `EditComment`: thread `id`, `commentId`, `actorId`, `expectedBody`, replacement
  `body`, and `editedAt`.
- `SetCommentThreadResolved`: thread `id`, `actor`, `resolved`, and `at`.
- `UpdateCommentAnchor`: thread `id`, `actorId`, and replacement `anchor`.

Before creating a Canvas or writing Notes or Comments, run `identity --json`.
If it fails, use the `crit-identity` skill. `open --json` includes the Canvas
Owner plus active and resolved Comment threads. Use a normalized frame anchor
when an agent does not have an element anchor from the browser:

```json
[{"_tag":"AddCommentThread","id":"thread-agent-1","frameId":"candidate","anchor":{"kind":"frame","xRatio":0.5,"yRatio":0.5},"opening":{"id":"comment-agent-1","body":"Check this state","author":{"id":"git:<hash>","name":"Current Git User"},"createdAt":"2026-08-09T12:00:00.000Z","editedAt":null}}]
```

## Editing rules

- A harness may signal a running agent with `activity <canvas> --id <run-id>
  --harness <harness> --detail <work> --json`. Renew the same identity about
  every 20 seconds and clear it with `activity <canvas> --id <run-id> --clear
  --json` when work ends. Ordinary Canvas commands do not create presence.
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
- Use Comments for feedback on a specific live Frame location or element. Use
  Notes for general Canvas context. Archived snapshot Frames reject Comments.
- Preserve the Git-derived Comment author ID and name reported by Crit. Never
  impersonate a different author. Replies are flat; do not model nested replies.
- Canvas creation records the verified Git Author as immutable Canvas Owner.
- Only edit a Comment when its author ID matches the current actor. Only the
  Canvas Owner or opening Comment Author may resolve, reopen, or re-anchor a
  thread.
- Ask before replacing or discarding user-authored Canvas content.
- Use `ready-for-review` when an implementation is complete and waiting for a
  person to assess it; use `approved` only after that assessment.
- Use `snapshot <canvas> <frame> --json` when the user asks to preserve the
  current rendered version. Keep the live Frame; the command adds a separate
  archived Frame and immutable artifact.

## Setup and diagnosis

Run `npx @riff-refine/crit init` when Crit is not configured. The initializer
installs the Vite adapter, reusable React surface, ignore rule, default manifest,
this project skill, and the independent `crit-identity` skill. Init verifies the
current user's Git identity before writing setup files. The Vite plugin owns `/crit/:canvasId?`, independent of
the host router. If discovery fails, verify that
`GET /.well-known/crit.json` returns a manifest. If the editor cannot load,
verify the Vite plugin is enabled and that `GET /__crit/api/canvases/<id>`
returns a Canvas Document.

Snapshot capture requires the local Vite plugin and a reachable HTTP(S) Frame.
Artifacts live in `.crit/snapshots` and are served at
`/__crit/snapshots/<artifact-id>`; do not edit or replace them directly.

Crit V1 is local-only. Do not expose its local HTTP endpoints as a remote
collaboration service.
