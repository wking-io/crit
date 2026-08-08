# wking dev-canvas extraction

The original implementation history is preserved on
`archive/wking-dev-canvas`. Path filtering rewrites commit identities, so the
original `wking` commits are recorded here in chronological order:

- `90e299b` — WIP
- `02f70ac` — feat(dev-canvas): add animated status pill stack
- `31932e1` — WIP
- `950a028` — refactor(dev-canvas): finalize frame interactions
- `94cdfe0` — WIP: add frozen URL snapshots to dev canvas

Production `main` starts from a clean package foundation. Behavior is ported in
intentional Effect v4 tracer bullets instead of inheriting host-specific WIP
ancestry.

