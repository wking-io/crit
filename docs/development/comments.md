# Comments (internal development)

Comments are a development-gated Crit capability. The Canvas Document still
stores Comment Threads so unrelated edits round-trip existing records. The
alpha profile does not expose Comments in the editor, CLI apply surface, HTTP
apply contract, Frame bridge, or installed agent skill.

Enable Comments only in the internal playground or another composition root
that passes `DEVELOPMENT_FEATURES`.

## Domain

Comment Threads belong to live Frames and contain one opening Comment followed
by flat Replies. Canvas-core predicates project Comment editing and thread
resolution capabilities, and the semantic commands enforce those same durable
invariants.

`CommentThreadReview` is a separate per-session module that owns the transient
create/read/edit/reply/resolve workflow. It reconciles stable identities from
each optimistic or authoritative Canvas Document and constructs command
batches, while `CanvasSession` remains responsible for dispatch and
persistence.

## UI and adapters

Element and Frame comment adapters terminate after producing a normalized
Comment Anchor or Comment Thread identity. React owns draft text, focus,
geometry, animation, and iframe readiness; `CommentThreadReview` owns workflow
state, capability projection, identity and timestamp allocation, and accepted
or rejected dispatch transitions. Resolved threads are omitted from Frame pins
but remain in the Canvas Document.

The Vite plugin injects the Frame comment bridge independently from the input
bridge, and only when the resolved feature profile enables Comments. CLI and
HTTP adapters reject Comment commands with a feature-unavailable failure when
Comments are disabled.

## Commands

- `AddCommentThread`: `id`, `frameId`, an `anchor`, and an opening message.
- `ReplyToCommentThread`: thread `id` and a flat `reply` message.
- `EditComment`: thread `id`, `commentId`, `actorId`, `expectedBody`,
  replacement `body`, and `editedAt`.
- `SetCommentThreadResolved`: thread `id`, `actor`, `resolved`, and `at`.
- `UpdateCommentAnchor`: thread `id`, `actorId`, and replacement `anchor`.

Archived snapshot Frames reject Comments. Only a Comment's Author may edit it.
Only the Canvas Owner or opening Comment Author may resolve, reopen, or
re-anchor a thread.
