# Split `canvas-viewport.tsx`

**Strength:** Worth exploring · **Area:** React viewport

## Problem

`src/react/canvas-viewport.tsx` is 2,163 lines and the hottest file in git
history. It mixes camera math, frame-chrome layout policy, five components
(`CanvasViewport`, `FrameCard`, `CritContextMenu`, `NewFrameDialog`,
`NoteCard`, `OrderControls`), and iframe event plumbing. Zoom-physics tuning,
chrome tweaks, and menu changes all land in the same file — the Divergent
Change smell.

## Proposed fix

Move `FrameCard`, `CritContextMenu`, `NewFrameDialog`, `NoteCard`, and
`OrderControls` into their own modules. Do this *after* (or together with) the
deeper extractions that remove behavior from the file, so the split follows
the seams rather than freezing the current shape:

- issue 012 (camera module)
- issue 013 (Frame input relay)
- issue 016 (interaction rules)

Also present in this file: duplicated drag-preview-with-attached-notes logic
(`:714-733` vs `:794-809`) and duplicated context-menu item rendering
(`:1840-1897` vs `:1918-1950`) — consolidate during the split.

## Origin

Standards review (Divergent Change) and architecture review, 2026-08-09.
