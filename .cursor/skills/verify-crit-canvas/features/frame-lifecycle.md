# Frame lifecycle

## Sub-features

Initial viewport mounting, offscreen paint suspension, viewport re-entry, and iframe identity preservation.

## How to get to it (user POV)

Open the seven-frame performance Canvas and pan until distant Frames enter and leave the viewport.

## Driving it with Chrome CDP

Use the suite's iframe count and wheel trace. Pair it with the `pauses offscreen Frame renderers` and viewport re-entry React tests when changing occupancy behavior.

## Gotchas

An offscreen Frame that has never entered should have no iframe. Once mounted, leaving the viewport should stop painting without replacing the iframe.
