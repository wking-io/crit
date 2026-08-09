# React tests assert implementation constants, not behavior

**Severity:** Low · **Area:** tests (`test/react/crit.test.tsx`)

## Problem

Several tests would break on internal refactors that change no behavior:

- CSS-string containment: `expect(critStyles).toContain("--crit-ink: #191918")`,
  `expect(critStyles.split(MOVE_CANVAS_CURSOR)).toHaveLength(3)`.
- Exact object equality of `CRIT_HOTKEYS` and `FRAME_SIZE_PRESETS`.
- Counts of `data-resize-handle` attributes in static markup.

These pin implementation constants rather than describing observable behavior
through an interface. Meanwhile the actual interaction wiring (drag, resize,
attach, zoom inertia) has no tests — see issues 012, 013, and 016.

## Proposed fix

As the viewport deepenings land, replace constant-pinning assertions with
behavior assertions at the new module interfaces, and delete the ones that no
longer earn their keep ("replace, don't layer").

## Origin

Architecture review (test-suite cross-check) of the 2026-08-09 review.
