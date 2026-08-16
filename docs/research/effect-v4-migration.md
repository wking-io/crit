# Effect v4 `beta.105` to `rc.109` migration audit

Reviewed 2026-08-16 against the official npm packages and Effect repository. This report is scoped to the upgrade from the versions originally pinned by Crit (`4.0.0-beta.105`) to the newest publicly available Effect v4 release (`4.0.0-rc.109`), not to a v3-to-v4 migration.

## Result

Crit does **not require application-source changes** for `4.0.0-rc.109`. The three direct Effect packages must move together to the same release-candidate version:

- `effect`: `4.0.0-rc.109`
- `@effect/platform-node`: `4.0.0-rc.109`
- `@effect/vitest`: `4.0.0-rc.109`

Effect's official migration guide says the v4 ecosystem packages share one version and must be upgraded in lockstep. It also warns that v4 prerelease APIs can change and that `effect/unstable/*` modules have weaker compatibility guarantees. [Official v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)

The repository now satisfies that lockstep requirement in [`package.json`](../../package.json). TypeScript 5.9.2 accepts the project with `npx tsc -p tsconfig.json --noEmit`, and the final complete Vitest run passes all 55 files / 265 tests under `rc.109`. No source migration was needed.

## What “latest v4” means

As of 2026-08-16, npm's tags are deliberately split:

| npm tag | `effect` version | Meaning |
|---|---:|---|
| `latest` | `3.22.1` | Current stable release; **not v4** |
| `beta` | `4.0.0-beta.107` | Last v4 beta |
| `rc` | `4.0.0-rc.109` | Newest v4 build |

Therefore `npm install effect@latest` would downgrade this project to v3, and `effect@beta` would stop at beta.107. The exact target for the user's “latest v4” request is `effect@4.0.0-rc.109` (or `effect@rc`). The same `rc.109` tag exists for the Node platform and Vitest packages. [npm: `effect@4.0.0-rc.109`](https://www.npmjs.com/package/effect/v/4.0.0-rc.109), [npm: `@effect/platform-node@4.0.0-rc.109`](https://www.npmjs.com/package/@effect/platform-node/v/4.0.0-rc.109), [npm: `@effect/vitest@4.0.0-rc.109`](https://www.npmjs.com/package/@effect/vitest/v/4.0.0-rc.109)

GitHub marks `effect@4.0.0-rc.109` as a prerelease published on 2026-08-14. It contains patch changes rather than a new major migration chapter. [Official `rc.109` release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.109)

## Confirmed required dependency changes

### Keep all Effect packages on `rc.109`

The companion packages declare `effect@^4.0.0-rc.109` as a peer, while `@effect/vitest` also requires Vitest `>=4.1.0 <5.0.0`. Crit already uses Vitest 4.1.0, so only the three Effect version pins and lockfile resolution need to change. [Official `@effect/vitest` package metadata](https://github.com/Effect-TS/effect/blob/%40effect%2Fvitest%404.0.0-rc.109/packages/vitest/package.json)

### Accept the Node Redis peer swap in the lockfile

`@effect/platform-node@rc.109` replaces its required `ioredis` peer (`>=5.7 <6`) with `redis` / node-redis (`>=5 <7`). Its `NodeRedis` configuration and command surface also changed to node-redis conventions. [Official platform-node `rc.109` release note](https://github.com/Effect-TS/effect/releases/tag/%40effect%2Fplatform-node%404.0.0-rc.109), [change PR #7221](https://github.com/Effect-TS/effect/pull/7221)

npm consequently removes the old ioredis peer tree and resolves `redis@6.2.1` plus its peer packages in [`package-lock.json`](../../package-lock.json). Crit does not import `NodeRedis`, so there is no Redis source migration. Its production Node imports are limited to `NodeRuntime` and `NodeServices` in [`src/cli.ts`](../../src/cli.ts) and `NodeServices` in [`src/node/file-system-canvas-repository.ts`](../../src/node/file-system-canvas-repository.ts). A source-level comparison of the published `beta.105` and `rc.109` platform tarballs found the Node platform implementation change confined to `NodeRedis`; the used Node modules retain their public declarations.

## Upstream changes reviewed against Crit

| Upstream change since beta.105 | Crit exposure | Assessment |
|---|---|---|
| The standalone `SchemaError` module was removed and `SchemaError` moved into `Schema`. [Official `rc.108` release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.108), [PR #7181](https://github.com/Effect-TS/effect/pull/7181) | Crit imports `Schema` only and does not import `effect/SchemaError`. | No change required. Existing `Schema.ErrorInstance` and schema decode usage compile. |
| `Schema.toArbitrary` now returns an arbitrary factory; `toArbitraryLazy` and derivation reports were removed. [Official beta.106 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.106), [PR #7148](https://github.com/Effect-TS/effect/pull/7148) | No `toArbitrary` or `toArbitraryLazy` calls. | No change required. |
| Schema canonical-AST memoization, representation identity, union candidate selection, and JSON Schema pattern import handling changed. [beta.106 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.106), [beta.107 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.107), [rc.108 notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.108) | High runtime exposure: 29 source files define or use schemas, including the large tagged `CanvasCommandSchema` union and persisted Canvas documents. Crit does not import JSON Schema documents. | No code change confirmed. Full schema/domain tests pass; retain these tests as the upgrade gate. |
| Synchronous scheduler dispatch now uses Promise microtasks. [Official `rc.108` release, PR #7178](https://github.com/Effect-TS/effect/pull/7178) | Five source files call `Effect.runFork`: [`canvas-live-refresh.ts`](../../src/browser/canvas-live-refresh.ts), [`canvas-action-runner.tsx`](../../src/react/canvas-action-runner.tsx), [`canvas-viewport.tsx`](../../src/react/canvas-viewport.tsx), [`crit.tsx`](../../src/react/crit.tsx), and [`frame-card.tsx`](../../src/react/frame-card.tsx). | No source change confirmed. This was the highest behavioral risk because callback ordering can shift by a microtask; the complete test suite passes. |
| `Deferred.await` interruption and `Queue.await` completion bugs were fixed. [Official `rc.108` release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.108) | `Deferred` coordinates canvas-session and action-runner tests; Crit does not use `Queue` directly. | Beneficial runtime fixes; no migration required. |
| `Duration` hashing was corrected so equal millisecond/nanosecond representations hash identically. [Official beta.107 release, PR #7153](https://github.com/Effect-TS/effect/pull/7153) | Crit uses `Duration.Input` for scheduling but does not key a `HashMap` or `HashSet` by `Duration`. | No migration required. |
| `Effect.fromOption` data-first inference was repaired. [Official `rc.109` release, PR #7240](https://github.com/Effect-TS/effect/pull/7240) | No `Effect.fromOption` calls. | No migration required. |
| `Fiber.joinAll` now preserves the iterable fibers' error type. [Official beta.106 release, PR #7111](https://github.com/Effect-TS/effect/pull/7111) | Crit uses `Fiber.join`, not `Fiber.joinAll`. | No migration required. |
| `Migrator.fromFileSystem` now also requires the `Path` service when callers provide `FileSystem` alone. [Official beta.107 release, PR #7166](https://github.com/Effect-TS/effect/pull/7166) | No SQL migrator usage. Existing Node filesystem code provides aggregate `NodeServices.layer`. | No migration required. |
| `NodeRedis` moved from ioredis to node-redis and its layer can now fail during connection construction. [Official platform-node `rc.109` release](https://github.com/Effect-TS/effect/releases/tag/%40effect%2Fplatform-node%404.0.0-rc.109) | No Redis import or Redis layer construction. | Lockfile-only impact today. Revisit before adopting `NodeRedis`. |
| The remaining changes concern RcRef, TxQueue, SQL, cluster, MCP, event log encryption, multipart/HTTP, OpenAPI, observability, and TestClock behavior. [beta.106](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.106), [beta.107](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-beta.107), [rc.108](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.108), [rc.109](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0-rc.109) | Crit does not import those affected APIs. | No migration required. |

## Unstable API watch list

Crit intentionally imports `Argument`, `Command`, and `Flag` from `effect/unstable/cli`, and `ChildProcess` / `ChildProcessSpawner` from `effect/unstable/process` in [`src/cli/command.ts`](../../src/cli/command.ts). Effect explicitly reserves the right to make breaking changes to unstable modules outside normal semver guarantees. [Official unstable-module policy](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md#unstable-module-system)

The published declaration diff from beta.105 to rc.109 adds optional CLI `renderErrors` and child-process `windowsHide` options but does not remove or change the used constructors and combinators. The CLI and process tests pass, so no change is required for this release. These imports remain the most likely source-migration hotspots for the next v4 RC or final release.

## Verification and remaining risk

Confirmed locally under the resolved `rc.109` dependency graph:

- `npm ls` resolves one deduplicated `effect@4.0.0-rc.109`, matching platform-node and Vitest companions.
- `npx tsc -p tsconfig.json --noEmit` passes with no application edits.
- The full Vitest suite passes: 55 files, 265 tests.
- There are no imports of the removed `effect/SchemaError` module, changed Schema arbitrary APIs, `NodeRedis`, SQL migrators, or the other changed subsystems.

The remaining risk is prerelease churn, not a known `rc.109` incompatibility. Keep the versions exact rather than using a prerelease range, upgrade all Effect packages together, and rerun typecheck plus the entire test suite for every subsequent RC. Runtime smoke testing should continue to emphasize browser live refresh, React action fibers, session save/refresh scheduling, CLI child processes, and persisted-schema backward compatibility.
