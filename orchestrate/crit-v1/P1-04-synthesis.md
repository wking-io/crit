# P1-04 design synthesis

## Caller contract

The future `CanvasAuthority` receives a semantic `ProposedCanvasChange`. The future `CanvasReplica` receives semantic accepted changes, pages, and receipts. Neither interface carries wire message kinds or schema versions.

Transport adapters use root-specific codecs grouped under `ChangeProtocol`. Each codec adds or removes a private versioned wire root.

## Selected shape

- Add one unauthored command. `RenameCanvas` carries `expectedTitle` and `title`.
- Construct command batches with `Schema.NonEmptyArray`.
- Keep semantic change values public and wire roots private.
- Use separate codecs for proposed changes, accepted changes, pages, receipts, and failures.
- Start accepted sequences at 1.
- Return a non-null opaque cursor from every successful page.
- Return the full accepted change for both first acceptance and identical retry.
- Distinguish malformed input, message-kind mismatch, unsupported version, and client-authored trusted fields.
- Export validated Cursor and Sequence construction without exposing cursor parsing, ordering, comparison helpers, or sequence conversion. Cursor remains a JSON-safe branded string; native string operations are not a security boundary.
- Embed a complete versioned accepted-change root inside a page or receipt.

## Arena result

Candidate C supplied the base. Its semantic values keep protocol versions out of Authority and Replica interfaces.

The synthesis grafted these choices:

- Candidate B supplied root-specific codecs, validated protocol values, positive sequences, and non-null page cursors.
- Candidate A supplied the preconditioned command, the full accepted-change receipt, and the distinct trusted-field failure.

## Rejected choices

- A universal message decoder makes every caller narrow unrelated roots.
- Public wire envelopes leak version dispatch into Authority and Replica code.
- Three Frame commands freeze geometry and mutation vocabulary before `CanvasEngine` owns their behavior.
- A compact receipt forces a Replica to pull the accepted change before it can settle pending work.
- Nullable page cursors make empty and terminal pages ambiguous.
- Public idempotency digests, authentication subjects, cursor payloads, and sequence allocation details expose Authority internals.

## Verification contract

Checked-in fixtures cover every valid root. Adversarial tests cover empty batches, extra fields at every level, unknown versions, wrong kinds, unsafe sequences, malformed cursors, trusted fields in proposals, unsafe attribution, receipt privacy, command order, and encoded round trips.

The implementation must compile with ES2022 only. It may import `effect`, `@crit/domain`, and local modules. It may not import transport, platform, storage, alpha, or authentication-subject types.
