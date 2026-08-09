# One deep camera module

**Strength:** Strong · **Dependency category:** in-process

## Files

- `src/react/canvas-viewport.tsx:78-186` (exported camera math), `:396-475`
  (velocity refs + RAF inertia loop), `:561-594` (wheel/pinch/step application)
- `src/react/zoom-physics.ts`
- `src/react/index.ts` (re-exports ~10 camera/chrome helpers)

## Problem

The camera concept lives half in the viewport and half in `zoom-physics`, with
literal duplication: `cameraAtPoint` is implemented identically in both files.
Zoom bounds exist as `MINIMUM_CANVAS_ZOOM`/`MAXIMUM_CANVAS_ZOOM` in
`zoom-physics.ts` yet the viewport hardcodes `0.1`/`2` at four separate sites —
change the zoom range and the sites drift.

The pure helpers (`cameraAfterWheel`, `cameraAfterZoomStep`, …) are exported
from the package interface solely so tests can reach them, while the real bug
surface — the RAF inertia loop juggling `zoomVelocityRef`/`zoomFrameTimeRef`
and the capture-phase wheel/gesture wiring — has zero tests and no locality.

## Proposed deepening

Merge camera math, clamps, impulse functions, and the physics stepper into one
camera module whose interface is roughly "current camera + input event
(wheel/pinch/step/impulse/tick) → next camera (+ velocity)". `CanvasViewport`
keeps only DOM listener wiring. Stop re-exporting the helpers from
`src/react/index.ts`; test the module through its own interface (inertia,
clamping, and anchor-point invariants need no DOM).

## Origin

Architecture review, candidate 3, 2026-08-09.
