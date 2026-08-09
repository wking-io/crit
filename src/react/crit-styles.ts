import { resizeCursors } from "./resize-cursors.js"
import { MOVE_CANVAS_CURSOR } from "./move-cursor.js"

export const critStyles = String.raw`
.crit-canvas {
  --crit-ink: #191918;
  --crit-paper: oklch(98.5% 0 none);
  --crit-line: #d8d5cc;
  --crit-muted: #77746c;
  --crit-accent: #ff5c35;
  background: var(--crit-paper);
  color: #191918;
  cursor: var(--crit-canvas-cursor);
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  isolation: isolate;
  overflow: clip;
  overscroll-behavior: none;
  overscroll-behavior-x: none;
}

.crit-canvas, .crit-canvas * { box-sizing: border-box; }
.crit-canvas button, .crit-canvas input, .crit-canvas textarea { font: inherit; }

.crit-canvas__plane {
  height: 0;
  left: 0;
  position: absolute;
  top: 0;
  transform-origin: 0 0;
  width: 0;
}

.crit-canvas__pan-shield {
  background: transparent;
  cursor: var(--crit-canvas-cursor);
  inset: 0;
  position: absolute;
  touch-action: none;
  z-index: 900;
}

.crit-toolbar {
  align-items: center;
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: oklch(26.9% 0 0);
  display: flex;
  font-family: system-ui, -apple-system, sans-serif;
  gap: 8px;
  height: 40px;
  left: 20px;
  padding: 0 8px 0 14px;
  pointer-events: auto;
  position: absolute;
  top: 17px;
  width: 365px;
  z-index: 1000;
}

.crit-toolbar__title {
  align-items: flex-start;
  display: flex;
  flex: 0 0 142px;
  gap: 6px;
  max-width: 142px;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crit-toolbar__title > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.crit-toolbar__title svg { flex: 0 0 16px; }

.crit-toolbar__group {
  align-items: flex-start;
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.crit-toolbar__divider {
  align-self: stretch;
  background: oklch(14.7% 0.004 49.3 / 20%);
  flex: 0 0 .5px;
  width: .5px;
}

.crit-icon-button {
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  display: grid;
  flex: 0 0 auto;
  height: 24px;
  padding: 0;
  place-items: center;
  position: relative;
  text-decoration: none;
  width: 24px;
}

.crit-icon-button:hover, .crit-icon-button:focus-visible,
.crit-icon-button[aria-expanded="true"] { background: oklch(14.7% 0.004 49.3 / 8%); }
.crit-icon-button[aria-pressed="true"] { background: oklch(14.7% 0.004 49.3 / 8%); }
.crit-icon-button[aria-disabled="true"] { cursor: default; }
.crit-icon-button svg { height: 16px; width: 16px; }

.crit-frame {
  --crit-ui: 1;
  background: var(--frame-shell);
  border-radius: calc(8px * var(--crit-ui));
  color: var(--frame-ink);
  overflow: visible;
  position: absolute;
}

.crit-frame::before {
  border-radius: inherit;
  box-shadow:
    oklch(14.7% 0.004 49.3 / 10%) 0 calc(2px * var(--crit-ui)) calc(4px * var(--crit-ui)),
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 calc(.5px * var(--crit-ui));
  content: "";
  inset: calc(28px * var(--crit-ui)) 0 0;
  pointer-events: none;
  position: absolute;
  z-index: 3;
}

.crit-frame__chrome {
  align-items: center;
  background: linear-gradient(var(--frame-shell), var(--frame-shell)), var(--crit-paper);
  border-start-end-radius: inherit;
  border-start-start-radius: inherit;
  cursor: ${MOVE_CANVAS_CURSOR};
  display: flex;
  font-family: system-ui, -apple-system, sans-serif;
  gap: calc(12px * var(--crit-ui));
  height: calc(28px * var(--crit-ui));
  justify-content: space-between;
  padding: 0 calc(8px * var(--crit-ui));
  position: relative;
  z-index: 4;
}

.crit-frame__identity {
  align-items: center;
  display: flex;
  flex: 1;
  gap: calc(6px * var(--crit-ui));
  min-width: 0;
}

.crit-frame__mark, .crit-frame__action {
  background: transparent;
  border: 0;
  color: var(--frame-ink);
  cursor: pointer;
  display: grid;
  flex: 0 0 calc(16px * var(--crit-ui));
  height: calc(16px * var(--crit-ui));
  padding: 0;
  place-items: center;
  position: relative;
  text-decoration: none;
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.22, 1, .36, 1);
  width: calc(16px * var(--crit-ui));
}

.crit-frame__mark:hover, .crit-frame__mark:focus-visible,
.crit-frame__action:hover, .crit-frame__action:focus-visible { transform: scale(1.12); }
.crit-frame__mark svg, .crit-frame__action svg { height: 100%; width: 100%; }
.crit-frame__action:disabled { cursor: wait; opacity: .55; }

.crit-frame__title-mask {
  display: block;
  flex: 1;
  height: calc(20px * var(--crit-ui));
  min-width: 0;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, transparent 0, #000 calc(2px * var(--crit-ui)), #000 calc(100% - 2px * var(--crit-ui)), transparent 100%);
}

.crit-frame__title-track {
  display: flex;
  flex-direction: column;
  min-width: 0;
  transform: translateY(0);
  transition: transform 220ms cubic-bezier(.22, 1, .36, 1);
}

.crit-frame__title-button {
  align-items: flex-start;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: text;
  display: flex;
  gap: calc(4px * var(--crit-ui));
  height: 100%;
  max-width: 100%;
  padding: 0;
  text-align: left;
  width: max-content;
}

.crit-frame__title-edit-icon {
  flex: 0 0 calc(16px * var(--crit-ui));
  height: calc(16px * var(--crit-ui));
  margin-top: calc(2px * var(--crit-ui));
  opacity: 0;
  transform: translateX(calc(5px * var(--crit-ui)));
  transition: opacity 140ms ease, transform 180ms cubic-bezier(.22, 1, .36, 1);
  width: calc(16px * var(--crit-ui));
}
.crit-frame__title-button:hover .crit-frame__title-edit-icon,
.crit-frame__title-button:focus-visible .crit-frame__title-edit-icon {
  opacity: 1;
  transform: translateX(0);
}

.crit-frame__title-mask > input {
  background: transparent;
  border: 0;
  color: inherit;
  font: 400 calc(14px * var(--crit-ui))/calc(20px * var(--crit-ui)) system-ui, -apple-system, sans-serif;
  height: 100%;
  min-width: 0;
  outline: 0;
  padding: 0;
  width: 100%;
}

.crit-frame__identity:has(.crit-frame__mark:hover) .crit-frame__title-track,
.crit-frame__identity:has(.crit-frame__mark[aria-expanded="true"]) .crit-frame__title-track {
  transform: translateY(calc(-20px * var(--crit-ui)));
}

.crit-frame__title-track strong {
  align-content: center;
  display: block;
  flex: 0 0 calc(20px * var(--crit-ui));
  font-size: calc(14px * var(--crit-ui));
  font-weight: 400;
  height: calc(20px * var(--crit-ui));
  line-height: calc(20px * var(--crit-ui));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crit-frame__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: calc(6px * var(--crit-ui));
}

.crit-frame__action[data-snapshotting] svg {
  animation: crit-frame-snapshot-pulse 700ms ease-in-out infinite alternate;
}

@keyframes crit-frame-snapshot-pulse {
  to { opacity: .45; transform: scale(.82); }
}

.crit-frame__viewport {
  background: oklch(97% 0.001 106.4);
  border-radius: calc(8px * var(--crit-ui));
  height: calc(100% - 28px * var(--crit-ui));
  overflow: hidden;
  position: relative;
}

.crit-frame__viewport::after {
  border-radius: inherit;
  box-shadow: oklch(100% 0 0 / 50%) 0 0 0 calc(1px * var(--crit-ui)) inset, oklch(100% 0 0 / 60%) 0 calc(1px * var(--crit-ui)) 0 inset;
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 2;
}
.crit-frame__viewport iframe { background: oklch(97% 0.001 106.4); border: 0; height: 100%; width: 100%; }
.crit-frame__paused { color: var(--crit-muted); font: calc(10px * var(--crit-ui))/1.5 system-ui, sans-serif; padding: calc(24px * var(--crit-ui)); }

.crit-status-menu {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  gap: calc(16px * var(--crit-ui));
  left: 0;
  pointer-events: auto;
  position: absolute;
  width: max-content;
  z-index: 10;
}

.crit-canvas .crit-status-option {
  align-items: center;
  background: var(--status-shell);
  border: 0;
  border-radius: calc(8px * var(--crit-ui));
  box-shadow: var(--status-stroke) 0 0 0 calc(1px * var(--crit-ui)), 0 calc(4px * var(--crit-ui)) calc(12px * var(--crit-ui)) rgba(25,25,24,.08);
  color: var(--status-ink);
  cursor: pointer;
  display: grid;
  font: calc(12px * var(--crit-ui))/calc(16px * var(--crit-ui)) system-ui, -apple-system, sans-serif;
  gap: calc(2px * var(--crit-ui));
  grid-template-columns: calc(18px * var(--crit-ui)) minmax(0, 1fr);
  height: calc(24px * var(--crit-ui));
  padding: 0 calc(12px * var(--crit-ui)) 0 calc(8px * var(--crit-ui));
  text-align: left;
  width: max-content;
}
.crit-status-option:disabled { cursor: default; opacity: .45; }
.crit-status-option:hover, .crit-status-option[aria-checked="true"] { box-shadow: var(--status-ink) 0 0 0 calc(1px * var(--crit-ui)), 0 calc(6px * var(--crit-ui)) calc(16px * var(--crit-ui)) rgba(25,25,24,.13); }
.crit-status-option svg { height: calc(16px * var(--crit-ui)); width: calc(16px * var(--crit-ui)); }

.crit-note {
  background: #eeece5;
  border: calc(1px * var(--crit-ui)) solid #191918;
  box-shadow: calc(6px * var(--crit-ui)) calc(6px * var(--crit-ui)) 0 rgba(25,25,24,.18);
  color: #191918;
  overflow: visible;
  position: absolute;
}
.crit-note__chrome {
  align-items: center;
  background: #191918;
  color: #fff;
  cursor: ${MOVE_CANVAS_CURSOR};
  display: flex;
  font: 700 calc(9px * var(--crit-ui))/1 system-ui, sans-serif;
  height: calc(28px * var(--crit-ui));
  justify-content: space-between;
  letter-spacing: .08em;
  padding: 0 calc(8px * var(--crit-ui));
  text-transform: uppercase;
}
.crit-note__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crit-note__actions { display: flex; gap: calc(3px * var(--crit-ui)); }
.crit-note__actions button { background: transparent; border: 0; color: #fff; cursor: pointer; height: calc(18px * var(--crit-ui)); padding: 0; width: calc(18px * var(--crit-ui)); }
.crit-note textarea { background: transparent; border: 0; color: #191918; font: calc(12px * var(--crit-ui))/1.65 "JetBrains Mono", ui-monospace, monospace; height: calc(100% - 28px * var(--crit-ui)); outline: 0; padding: calc(12px * var(--crit-ui)); resize: none; width: 100%; }

.crit-note__select-shield {
  background: transparent;
  border: 0;
  bottom: 0;
  cursor: var(--crit-canvas-cursor);
  left: 0;
  padding: 0;
  position: absolute;
  right: 0;
  top: calc(28px * var(--crit-ui));
  z-index: 3;
}

.crit-selection {
  border-radius: inherit;
  box-shadow: 0 0 0 calc(1.5px * var(--selection-ui)) var(--selection-ink);
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 30;
}
.crit-selection__handle {
  background: transparent;
  border: 0;
  padding: 0;
  pointer-events: auto;
  position: absolute;
  touch-action: none;
}
.crit-selection__handle[data-visible-handle] {
  background: var(--crit-paper);
  border: calc(1.5px * var(--selection-ui)) solid var(--selection-ink);
  border-radius: calc(1px * var(--selection-ui));
  height: calc(8px * var(--selection-ui));
  width: calc(8px * var(--selection-ui));
}
.crit-selection__handle[data-resize-handle="north-west"] { cursor: ${resizeCursors.nwse}; left: 0; top: 0; transform: translate(-50%, -50%); }
.crit-selection__handle[data-resize-handle="north"] { cursor: ${resizeCursors.ns}; height: calc(12px * var(--selection-ui)); left: calc(8px * var(--selection-ui)); right: calc(8px * var(--selection-ui)); top: 0; transform: translateY(-50%); }
.crit-selection__handle[data-resize-handle="north-east"] { cursor: ${resizeCursors.nesw}; right: 0; top: 0; transform: translate(50%, -50%); }
.crit-selection__handle[data-resize-handle="east"] { bottom: calc(8px * var(--selection-ui)); cursor: ${resizeCursors.ew}; right: 0; top: calc(8px * var(--selection-ui)); transform: translateX(50%); width: calc(12px * var(--selection-ui)); }
.crit-selection__handle[data-resize-handle="south-east"] { bottom: 0; cursor: ${resizeCursors.nwse}; right: 0; transform: translate(50%, 50%); }
.crit-selection__handle[data-resize-handle="south"] { bottom: 0; cursor: ${resizeCursors.ns}; height: calc(12px * var(--selection-ui)); left: calc(8px * var(--selection-ui)); right: calc(8px * var(--selection-ui)); transform: translateY(50%); }
.crit-selection__handle[data-resize-handle="south-west"] { bottom: 0; cursor: ${resizeCursors.nesw}; left: 0; transform: translate(-50%, 50%); }
.crit-selection__handle[data-resize-handle="west"] { bottom: calc(8px * var(--selection-ui)); cursor: ${resizeCursors.ew}; left: 0; top: calc(8px * var(--selection-ui)); transform: translateX(-50%); width: calc(12px * var(--selection-ui)); }

.crit-help {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  bottom: 16px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: var(--crit-ink);
  display: grid;
  font-family: system-ui, -apple-system, sans-serif;
  gap: 12px;
  height: 128px;
  left: 16px;
  padding: 14px 16px;
  pointer-events: none;
  position: absolute;
  width: 320px;
  z-index: 4900;
}
.crit-help__header { display: flex; gap: 16px; justify-content: space-between; min-width: 0; }
.crit-help__field { display: grid; gap: 3px; min-width: 0; }
.crit-help__field--hotkey { flex: 0 0 auto; text-align: right; }
.crit-help__label { color: #77746c; font-size: 9px; font-weight: 700; letter-spacing: .08em; line-height: 11px; text-transform: uppercase; }
.crit-help strong { font-size: 13px; font-weight: 650; line-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crit-help kbd { color: #77746c; font: 600 10px/17px "JetBrains Mono", ui-monospace, monospace; white-space: nowrap; }
.crit-help__description p { font-size: 11px; line-height: 15px; margin: 0; }

.crit-frame:fullscreen {
  --crit-ui: 1 !important;
  border-radius: 0;
  height: 100vh !important;
  left: 0 !important;
  top: 0 !important;
  width: 100vw !important;
}
.crit-frame:fullscreen .crit-frame__chrome { height: 36px; }
.crit-frame:fullscreen .crit-frame__viewport { border-radius: 0; height: calc(100% - 36px); }
.crit-frame:fullscreen::before { inset-block-start: 36px; }

.crit-presence, .crit-save-state {
  border: 0;
  border-radius: 999px;
  color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  position: absolute;
  z-index: 1100;
}
.crit-presence { align-items: center; background: #191918; display: flex; font-size: 11px; font-weight: 600; gap: 7px; padding: 8px 11px; right: 24px; top: 24px; }
.crit-presence__dot { background: #d9ff6f; border-radius: 999px; height: 8px; width: 8px; }
.crit-save-state { background: rgba(25,25,24,.86); bottom: 16px; cursor: default; font-size: 10px; padding: 7px 9px; right: 16px; text-transform: capitalize; }
.crit-save-state:enabled { cursor: pointer; }

.crit-message { background: var(--crit-paper); color: #68655e; font: 500 12px/1.7 "JetBrains Mono", ui-monospace, monospace; }

.crit-context-menu {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow: oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px, oklch(14.7% 0.004 49.3 / 18%) 0 10px 30px;
  display: grid;
  gap: 2px;
  padding: 4px;
  position: fixed;
  width: 208px;
  z-index: 5000;
}
.crit-context-menu button, .crit-context-menu a {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: #191918;
  cursor: pointer;
  display: flex;
  font: 500 12px/1 system-ui, -apple-system, sans-serif;
  height: 32px;
  justify-content: space-between;
  padding: 0 10px;
  text-align: left;
  text-decoration: none;
  width: 100%;
}
.crit-context-menu__arrow { color: #77746c; font-size: 18px; margin-left: auto; }
.crit-context-menu__detail { color: #77746c; font-size: 10px; font-variant-numeric: tabular-nums; margin-left: 12px; }
.crit-context-menu--submenu { z-index: 5001; }
.crit-context-menu button:hover, .crit-context-menu button:focus-visible,
.crit-context-menu a:hover, .crit-context-menu a:focus-visible {
  background: oklch(14.7% 0.004 49.3 / 8%);
  outline: 0;
}
.crit-context-menu button[data-tone="danger"] { color: #b42318; }

.crit-dialog-backdrop {
  align-items: center;
  background: rgba(25, 25, 24, .28);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 24px;
  position: fixed;
  z-index: 5100;
}
.crit-new-frame-dialog {
  background: oklch(98.5% 0 none);
  border-radius: 10px;
  box-shadow: rgba(25, 25, 24, .22) 0 16px 48px, rgba(25, 25, 24, .2) 0 0 0 .5px;
  color: #191918;
  display: grid;
  font-family: system-ui, -apple-system, sans-serif;
  gap: 16px;
  max-width: 420px;
  padding: 20px;
  width: 100%;
}
.crit-new-frame-dialog h2 { font-size: 16px; margin: 0; }
.crit-new-frame-dialog label { display: grid; font-size: 12px; font-weight: 600; gap: 6px; }
.crit-new-frame-dialog label span { color: #77746c; font-weight: 400; }
.crit-new-frame-dialog input {
  background: #fff;
  border: 1px solid #d8d5cc;
  border-radius: 6px;
  color: #191918;
  font: 13px/20px system-ui, -apple-system, sans-serif;
  height: 38px;
  outline: 0;
  padding: 0 10px;
}
.crit-new-frame-dialog input:focus { border-color: #191918; }
.crit-new-frame-dialog__actions { display: flex; gap: 8px; justify-content: flex-end; }
.crit-new-frame-dialog__actions button {
  background: transparent;
  border: 1px solid #d8d5cc;
  border-radius: 6px;
  color: #191918;
  cursor: pointer;
  font: 600 12px/1 system-ui, -apple-system, sans-serif;
  height: 34px;
  padding: 0 12px;
}
.crit-new-frame-dialog__actions button[data-primary] { background: #191918; border-color: #191918; color: #fff; }

@media (max-width: 640px) {
  .crit-toolbar { left: 12px; max-width: calc(100% - 24px); top: 12px; }
  .crit-help { bottom: 12px; left: 12px; max-width: calc(100% - 24px); width: 320px; }
  .crit-presence { right: 12px; top: 64px; }
  .crit-save-state { bottom: 12px; right: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .crit-frame__mark, .crit-frame__action, .crit-frame__action[data-snapshotting] svg, .crit-frame__title-track, .crit-frame__title-edit-icon { animation-duration: .01ms; transition-duration: .01ms; }
}
`
