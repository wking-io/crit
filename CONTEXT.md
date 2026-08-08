# Crit

Crit is a local-first tool for arranging and assessing live web iterations.

## Language

**Crit**: The product, repository, and package that provides the review environment.

**Canvas**: A named review workspace containing the live web iterations being assessed together.

**Canvas Document**: The sole durable representation of a Canvas, including its Frames, Notes, layout, and monotonic revision.

**Frame**: A web iteration placed on a Canvas, together with its review status, stable identity, and geometry. A Frame is either live at its source URL or archived against an immutable Snapshot Artifact. Its identity is independent from its URL, and multiple Frames may reference the same URL.

**Snapshot Artifact**: A self-contained, minified HTML capture of a live Frame at one point in time. It is stored outside the Canvas Document and is never mutated after capture.

**Archived Frame**: A separate Frame created beside its live source Frame. It points to a Snapshot Artifact and records the source URL, capture time, artifact ID, and byte size.

**Snapshot Archive**: The storage and capture boundary for immutable Snapshot Artifacts.

**Note**: Plain-text review feedback with Canvas geometry. A Note may attach to a Frame so it moves with the Frame, then detach without changing its position.

**Canvas Repository**: The local persistence boundary that serializes semantic command batches under a per-Canvas filesystem lock.

**Canvas Session**: One browser window's optimistic view, autosave queue, draft recovery, and adoption of authoritative revisions.
