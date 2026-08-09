# Remove dead code and speculative generality

**Severity:** Low · **Area:** core, React

## Findings

- `current.title = draft.title` in `Canvas.apply` (`src/core/canvas.ts:705`) —
  no command can change a Canvas title, so this line is dead. Either delete it
  or add the missing `RenameCanvas` command if a title edit is actually wanted.
- The lock file writes the owning PID
  (`src/node/file-system-canvas-repository.ts:139-141`) but nothing reads it —
  keep it only if issue 001 (stale-lock detection) starts using it.
- Unused `style` prop on `OrderControls`
  (`src/react/canvas-viewport.tsx:2132-2140`).
- Alias types `FrameSummary = CanvasFrame` / `NoteSummary = CanvasNote`
  (`src/core/canvas.ts:82-90`) add no meaning — use the underlying types, or
  make the summaries actually narrower.

## Proposed fix

Delete each (or give it a real consumer). All are single-site changes.

## Origin

Standards review (Speculative Generality) of the 2026-08-09 architecture and
code review.
