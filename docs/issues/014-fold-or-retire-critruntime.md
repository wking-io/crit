# Fold or retire `CritRuntime` (single-adapter seam)

**Strength:** Worth exploring · **Dependency category:** in-process, over a local-substitutable store

## Files

- `src/runtime/crit-runtime.ts:62-144`
- Consumers: `src/cli/command.ts`, `src/discovery/crit-manifest.ts:310-386`, `src/vite/index.ts:332`

## Problem

`CritRuntimeShape` declares five methods whose error unions restate the
repository's verbatim (~30 lines of interface for ~40 lines of
implementation); `readCanvas` is a literal pass-through
(`readCanvas: documents.load`). There is exactly one adapter
(`CritRuntimeLive`) and no test adapter — per seam discipline, a hypothetical
seam: indirection, not variation.

The deeper friction: the Vite plugin serves the *same* operations through a
*different* stack (`CanvasRepositoryCritClient` over the same repository) and
wires `CritRuntimeLive` in addition, solely so `CritManifest.sync` can find it.
One process holds two parallel read/apply interfaces over one Canvas
Repository, with different `createIfMissing` behavior and separate error
vocabularies (see issue 010).

## Proposed deepening

Either (a) fold the summary/view reads into `CritClientShape` so CLI, manifest
sync, and the Vite HTTP path share a single durable-access interface with two
adapters (in-process and HTTP) — one real seam; or (b) keep `CritRuntime`,
delete `readCanvas`, and make it the *only* in-process consumer surface,
removing the duplicate stack in the Vite plugin.

## Origin

Architecture review, candidate 5, 2026-08-09.
