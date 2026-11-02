---
name: verify-crit-canvas
description: Verify Crit's alpha and v1 browser canvases, interaction performance, rendering behavior, and UI controls in real Chrome.
---

# Verify the Crit canvas

## Launch

Build the rewritten packages and host first:

```sh
npx tsc -b packages/react packages/cli
npm run build --workspace @crit/host
```

Start the alpha fixture on port 5174 and retain its PID:

```sh
CRIT_PLAYGROUND_MODE=alpha CRIT_PLAYGROUND_PORT=5174 npx vite --config playground/vite.config.ts
```

Start v1 from the repository root and retain its PID:

```sh
node packages/cli/dist/main.js dev --application-origin http://127.0.0.1:5174/
```

The ready lines are `Local: http://127.0.0.1:5174/` and `Crit is at http://127.0.0.1:5173`. Seed the comparison canvas idempotently with `scripts/seed-performance-canvas.sh`. Stop only the two retained PIDs with `SIGINT`.

## Doctor

Before driving, require successful responses from both surfaces and verify the seeded Canvas exists:

```sh
curl --fail --silent http://127.0.0.1:5174/ >/dev/null
curl --fail --silent http://127.0.0.1:5173/ >/dev/null
node packages/cli/dist/main.js status
node packages/cli/dist/main.js open canvas_performance_lab_v2 >/dev/null
```

If any check fails, repair launch or seeding before trusting browser results.

## Drive

Run the real-Chrome comparison from the repository root:

```sh
node scripts/run-canvas-performance-suite.mjs
```

The helper creates a fresh isolated Chrome profile for each version, drives 120 wheel-pan events through Chrome DevTools Protocol, opens Canvas options and Add frame, and records frame cadence, long tasks, DOM mutations, React Profiler commits, browser layout/script costs, mounted iframes, response latency, and unlabeled controls. It fails when v1 falls outside the alpha-relative thresholds encoded in the helper.

For one surface only:

```sh
node scripts/measure-canvas-performance.mjs 'http://127.0.0.1:5173/canvas/canvas_performance_lab_v2?crit-perf=1' v1
```

## Evidence

Each suite run writes `alpha.json`, `v1.json`, and `summary.json` beneath `.artifacts/canvas-performance/<timestamp>/`. Preserve that directory. A valid proof uses the production browser paths, includes the driven action measurements and resulting DOM/browser state, and has every summary check passing. Unit tests alone are not canvas-performance evidence.

## Cleanup

Send `SIGINT` to the exact alpha and v1 PIDs retained during Launch and wait for both to exit. Never kill by process name. The Chrome helper removes only its own temporary profile in a `finally` block. Do not remove `.artifacts/canvas-performance`; evidence survives cleanup. The seeded Canvas is intentionally durable and the seed helper is idempotent.

## Helpers

- `scripts/seed-performance-canvas.sh`: creates the seven-frame v1 comparison Canvas through public CLI commands.
- `scripts/measure-canvas-performance.mjs <url> [label]`: measures one canvas in a fresh real Chrome process and prints JSON.
- `scripts/run-canvas-performance-suite.mjs [output-directory]`: compares alpha with v1, writes evidence, and returns nonzero on regression.
