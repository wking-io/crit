# Crit

Crit is a local-first tool for arranging and assessing live web iterations.

## Language

**Crit**: The product, repository, and package that provides the review environment.

**Canvas**: A named review workspace containing the live web iterations being assessed together.

**Canvas Document**: The sole durable representation of a Canvas, including its owner, Frames, Notes, Comment Threads, layout, and monotonic revision.

**Frame**: A web iteration placed on a Canvas, together with its review status, stable identity, and geometry. A Frame is either live at its source URL or archived against an immutable Snapshot Artifact. Its identity is independent from its URL, and multiple Frames may reference the same URL.

**Snapshot Artifact**: A self-contained, minified HTML capture of a live Frame at one point in time. It is stored outside the Canvas Document and is never mutated after capture.

**Archived Frame**: A separate Frame created beside its live source Frame. It points to a Snapshot Artifact and records the source URL, capture time, artifact ID, and byte size.

**Snapshot Archive**: The storage and capture boundary for immutable Snapshot Artifacts.

**Note**: Plain-text review feedback with Canvas geometry. A Note may attach to a Frame so it moves with the Frame, then detach without changing its position.

**Comment Thread**: A Canvas-owned feedback conversation pinned to a live Frame or to an element within that Frame. A Comment Thread contains one opening Comment and zero or more flat Replies, and may be active or resolved.

**Comment**: An authored message within a Comment Thread. The opening Comment owns the thread; subsequent Comments are Replies and cannot contain nested Replies.

**Comment Anchor**: The durable location of a Comment Thread within a live Frame. An Element Anchor identifies DOM content through the Crit Frame Bridge, while a Frame Anchor preserves a normalized point for an uninstrumented Frame.

**Canvas Owner**: The Git-derived Author who created or first upgrades a Canvas. The Canvas Owner may resolve or reopen any Comment Thread on that Canvas.

**Author**: A local collaborator identified by an opaque ID derived from Git identity and shown by Git committer name. Authors may edit their own Comments, and the opening Comment's Author may resolve or reopen its thread.

**Canvas Repository**: The local persistence boundary that serializes semantic command batches under a per-Canvas filesystem lock.

**Canvas Session**: One browser window's optimistic view, autosave queue, draft recovery, and adoption of authoritative revisions.

**Agent Activity**: A renewable, automatically expiring local coordination hint that an agent is working on a Canvas. It is not durable Canvas state, revision history, or remote-user presence.

**Agent Activity Store**: The ephemeral persistence boundary for Agent Activity. The filesystem adapter stores signals under `.crit/activity` separately from Canvas Documents.
