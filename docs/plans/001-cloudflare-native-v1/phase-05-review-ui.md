# Phase 5: Primary review UI

## Outcome

Port the useful alpha interaction model onto `CanvasReplica` and `RepresentationRuntime`.

## Build

- Implement Canvas navigation, Frame layout, stacking, resizing, review status, captures, presence, and sync state.
- Keep UI state such as camera, selection, hover, and transient drafts outside the canonical Canvas Projection.
- Show pending, synchronized, conflicted, unavailable, and offline states directly.
- Display Person and Agent authorship without implying that the Person who ran a local Agent performed the Agent's work.
- The same UI later ships as the hosted review UI. A teammate uses it without a local daemon.
- v1 is Frames only. The rewrite has no Note or Comment types, commands, or UI.
- Preserve loaded iframe behavior and responsive viewport presets where verified by the behavior reference. Do not add a fit-page display command.
- Port align and distribute, breakpoint presets, contextual help, pause-offscreen Frames, fullscreen, open in new tab, and developer copy-node-id. Do not port undo and redo.

## Prove

- Browser-driven feature tests cover every mutation and recovery state.
- Reload and daemon restart preserve durable work but not transient viewport state unless intentionally stored as preference.
- A failed pending edit remains visible and repairable.
- Accessibility, keyboard, pointer, trackpad, and iframe-input behavior match the accepted product behavior.
