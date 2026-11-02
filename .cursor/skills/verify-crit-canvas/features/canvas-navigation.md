# Canvas navigation

## Sub-features

Wheel/trackpad pan, frame cadence, camera persistence, and React render isolation.

## How to get to it (user POV)

Open the seeded performance Canvas in alpha or v1 and pan across its seven Frames.

## Driving it with Chrome CDP

Run the suite helper. It sends 120 real wheel inputs over the canvas and reads the query-gated performance probe plus Chrome performance metrics.

## Gotchas

Use a fresh foreground-equivalent Chrome profile with background throttling disabled. Synthetic DOM events do not exercise the browser input path.
