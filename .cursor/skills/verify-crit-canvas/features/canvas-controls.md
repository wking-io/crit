# Canvas controls

## Sub-features

Canvas options, Add frame dialog, Frame status menus, keyboard dismissal, response latency, and accessible labels.

## How to get to it (user POV)

Open a Canvas, use the top toolbar's Canvas options and Add frame buttons, or select a Frame and open its status control.

## Driving it with Chrome CDP

The measurement helper locates controls by accessible name, clicks through the browser input domain, waits for the menu or dialog role, and records the interaction window.

## Gotchas

Only click controls whose bounding rectangle is inside the viewport. Close transient surfaces with Escape before measuring the next control.
