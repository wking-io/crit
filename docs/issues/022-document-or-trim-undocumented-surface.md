# Document or trim the undocumented public surface

**Severity:** Low · **Area:** docs / package interface

## Problem

The shipped surface is larger than the documented one. Each extra item is a
compatibility promise being made implicitly:

- `<Crit>` props: `apiPath`, `autosaveDelay`, `sessionId`, `className`,
  `style`, `onCommandError`, `loadingFallback`, `errorFallback`
  (`src/react/crit.tsx:84-102`).
- Vite plugin options: `root`, `apiPath`, `title`, `manifest`, `manifestPath`,
  `frameInputBridge` (`src/vite/index.ts:37-47`), plus the undocumented
  `<editorPath>/__assets/editor.js` route.
- Package entry points: `/http`, `/discovery`, `/node` (`package.json`) are
  shipped but not mentioned in README.
- CLI: `crit add`, `crit create`, `sync --canvas`, `sync --base-url`,
  `init --root`, `init --skip-install` appear in no doc.
- The React entry re-exports ~10 internal helpers (`cameraAfterWheel`,
  `frameChromeLayout`, `stepZoomPhysics`, `CRIT_HOTKEYS`, …) solely so tests
  can reach them — issue 012 removes the camera ones; audit the rest.

## Proposed fix

For each item: document it in README, or stop exporting it. Do the export
audit before the first real release — shrinking the surface afterwards is a
breaking change.

## Origin

Spec review ("Undocumented surface") of the 2026-08-09 review.
