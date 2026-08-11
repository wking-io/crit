# Crit

Crit is a local-first tool for arranging and assessing live web iterations.

## Language

**Crit**: The product, repository, and package that provides the review environment.

**Canvas**: A named review workspace containing the live web iterations being assessed together.

**Canvas Document**: The sole durable representation of a Canvas, including its owner, Frames, Notes, Comment Threads, layout, and monotonic revision.

**Canvas Creation**: The explicit operation that creates a Canvas Document and records its Git-derived Canvas Owner. Loading a missing Canvas never creates it; creation occurs through manifest synchronization or `crit create`.

**Frame**: A web iteration placed on a Canvas, together with its review status, stable identity, and geometry. A Frame is either live at its source URL or archived against an immutable Snapshot Artifact. Its identity is independent from its URL, and multiple Frames may reference the same URL.

**Snapshot Artifact**: A self-contained, minified HTML capture of a live Frame at one point in time. It is stored outside the Canvas Document and is never mutated after capture.

**Archived Frame**: A separate Frame created beside its live source Frame. It points to a Snapshot Artifact and records the source URL, capture time, artifact ID, and byte size.

**Snapshot Archive**: The storage and capture boundary for immutable Snapshot Artifacts.

**Note**: Author-owned plain-text review feedback with Canvas geometry. Only the Note's Author may change its text or remove it; collaborators may arrange its width, position, stacking, and Frame attachment, while its content owns its height so every line remains visible. Removing its attached Frame detaches and preserves the Note.

**Comment Thread**: A Canvas-owned feedback conversation pinned to a live Frame or to an element within that Frame. A Comment Thread contains one opening Comment and zero or more flat Replies, and may be active or resolved.

**Comment Thread Review**: A Canvas Session's transient focus on composing a new Comment Thread or reading and acting on one existing Comment Thread. Exactly one may be active per Canvas Session; its durable facts remain in the Canvas Document.

**Comment**: An authored message within a Comment Thread. The opening Comment owns the thread; subsequent Comments are Replies and cannot contain nested Replies.

**Comment Anchor**: The durable location of a Comment Thread within a live Frame. An Element Anchor identifies DOM content through the Crit Frame Bridge, while a Frame Anchor preserves a normalized point for an uninstrumented Frame.

**Canvas Owner**: Every Canvas has exactly one Canvas Owner: the Author recorded when the Canvas is created. The Canvas Owner may resolve or reopen any Comment Thread on that Canvas.

**Author**: A local collaborator identified by an opaque ID derived from Git identity and shown by Git committer name. Authors may edit their own Notes and Comments, and the opening Comment's Author may resolve or reopen its thread.

**Git Author Identity**: The repository's effective, validated `user.name` and `user.email`, resolved through one reusable identity boundary. Initialization, Canvas Creation, and Canvas Session opening all require it; Crit never guesses it or changes global Git configuration.

**Identity Remediation Prompt**: The copy-ready agent instruction attached to missing or invalid Git Author Identity failures. It directs the independent `crit-identity` skill to ask the user for unknown values, write only confirmed repository-local configuration, and verify the result through `crit identity`.

**Current Author**: Every Canvas Session has exactly one Current Author: the Git-derived Author using that session. The Current Author supplies authorship for new Notes and Comments and is not part of the Canvas Document.

**Canvas Repository**: The local persistence boundary that serializes semantic command batches under a per-Canvas filesystem lock.

**Canvas Session**: One browser window's optimistic view, autosave queue, draft recovery, and adoption of authoritative revisions.

**Canvas Presence**: The ephemeral session view combining the Current Author with all active Agent Activities for a Canvas. It supports identity and work awareness without implying remote collaboration. Presence refreshes independently from the Canvas Document, immediately on local activity events and every five seconds as a fallback.

**Anonymous Presence**: The public fallback shown as one anonymous avatar when Agent Activities cannot be retrieved. The underlying failure is logged internally; the UI does not expose the error or falsely present an empty activity list.

**Presence Avatar**: A local, deterministic colored avatar containing a letter derived from the Current Author's name or an Agent Activity's harness name. Crit does not resolve or persist remote profile images; unreadable activity presence uses the anonymous fallback avatar.

**Agent Activity**: A renewable, automatically expiring local coordination hint with a stable opaque identity for one agent run working on a Canvas. Only a harness-supplied activity identity may create or renew one; ordinary CLI commands do not create presence, though they may carry existing harness context. Its descriptive metadata is reported by the harness, its identity is independent from optional external references, and it is not durable Canvas state, revision history, or remote-user presence.

**Agent Activity Store**: The ephemeral persistence boundary for independently expiring Agent Activities. The filesystem adapter stores one file per activity under `.crit/activity/<encoded-canvas-id>/<encoded-activity-id>.json`, separately from Canvas Documents and their locks or revisions.

**Agent Activity Renewal**: Replacement of one Agent Activity's harness-reported metadata under the same activity identity. Renewal preserves the activity identity, Canvas, and creation time; replaces harness, model, work detail, and external reference; and refreshes Crit's fixed 60-second lease. Harnesses renew about every 20 seconds and clear on clean completion. An omitted optional field clears its prior value.

**Agent Activity Reference**: A harness-neutral stable external kind and ID, optionally paired with a genuine desktop-app or web URI supplied by the harness. Crit may open the URI on explicit user action; when no supported URI exists, it shows the ID without inventing or executing a resume command.
