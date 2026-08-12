import { resizeCursors } from "./resize-cursors.js"
import { MOVE_CANVAS_CURSOR } from "./move-cursor.js"
import { FRAME_CORNER_RADIUS } from "./frame-geometry.js"

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
  max-width: calc(100% - 40px);
  padding: 0 8px 0 14px;
  pointer-events: auto;
  position: absolute;
  top: 17px;
  width: max-content;
  z-index: 1000;
}

.crit-toolbar__title {
  align-items: flex-start;
  display: flex;
  flex: 0 1 auto;
  gap: 6px;
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
  --crit-frame-chrome-height: calc(28px * var(--crit-ui));
  --crit-ui: 1;
  border-radius: calc(${FRAME_CORNER_RADIUS}px * var(--crit-ui));
  color: var(--frame-ink);
  isolation: isolate;
  overflow: visible;
  position: absolute;
}

.crit-frame__surface {
  background: var(--frame-shell);
  border-radius: inherit;
  box-shadow: var(--frame-stroke) 0 0 0 calc(.5px * var(--crit-ui));
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: visible;
  position: relative;
  z-index: 1;
}

.crit-frame__surface::before {
  border-radius: inherit;
  box-shadow:
    oklch(14.7% 0.004 49.3 / 10%) 0 calc(2px * var(--crit-ui)) calc(4px * var(--crit-ui)),
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 calc(.5px * var(--crit-ui));
  content: "";
  inset: var(--crit-frame-chrome-height) 0 0;
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
  flex: 0 0 var(--crit-frame-chrome-height);
  font-family: system-ui, -apple-system, sans-serif;
  gap: calc(12px * var(--crit-ui));
  height: var(--crit-frame-chrome-height);
  justify-content: space-between;
  padding: 0 calc(8px * var(--crit-ui));
  position: relative;
  z-index: 2;
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
.crit-frame__mark[aria-expanded="true"],
.crit-frame__action:hover, .crit-frame__action:focus-visible { transform: scale(1.08); }
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
.crit-frame__title-mask[data-editing="true"] { mask-image: none; }

.crit-frame__title-track {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  min-width: 0;
  transform: translateY(0);
  transition: transform 220ms cubic-bezier(.22, 1, .36, 1);
}

.crit-frame__title-label {
  display: flex;
  height: calc(20px * var(--crit-ui));
  max-width: 100%;
  width: max-content;
}

.crit-frame__title-button {
  align-items: flex-start;
  background: transparent;
  border: 0;
  color: var(--frame-ink);
  cursor: text;
  display: flex;
  gap: calc(4px * var(--crit-ui));
  font: inherit;
  height: calc(20px * var(--crit-ui));
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

.crit-frame__title-editor {
  align-items: center;
  color: var(--frame-ink);
  display: flex;
  font: 400 calc(14px * var(--crit-ui))/calc(20px * var(--crit-ui)) system-ui, -apple-system, sans-serif;
  gap: calc(3px * var(--crit-ui));
  height: calc(20px * var(--crit-ui));
  max-width: 100%;
  min-width: 0;
  width: max-content;
}
.crit-frame__title-prefix { flex: 0 0 auto; }
.crit-frame__title-input-sizer {
  display: inline-grid;
  flex: 0 1 auto;
  max-width: 100%;
  min-width: 1ch;
  overflow: hidden;
}
.crit-frame__title-input-sizer::after,
.crit-frame__title-input-sizer input {
  font: inherit;
  grid-area: 1 / 1;
  min-width: 0;
  white-space: pre;
}
.crit-frame__title-input-sizer::after {
  content: attr(data-value);
  overflow: hidden;
  visibility: hidden;
}
.crit-frame__title-input-sizer input {
  background: transparent;
  border: 0;
  border-radius: 0;
  color: inherit;
  height: calc(20px * var(--crit-ui));
  line-height: calc(20px * var(--crit-ui));
  outline: 0;
  padding: 0;
  width: 100%;
}
.crit-frame__title-save {
  background: transparent;
  border: 0;
  color: var(--frame-ink);
  cursor: pointer;
  display: grid;
  flex: 0 0 calc(16px * var(--crit-ui));
  height: calc(16px * var(--crit-ui));
  padding: 0;
  place-items: center;
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.22, 1, .36, 1);
  width: calc(16px * var(--crit-ui));
}
.crit-frame__title-save:hover,
.crit-frame__title-save:focus-visible { transform: scale(1.08); }

.crit-frame__identity:has(.crit-frame__mark:hover) .crit-frame__title-track,
.crit-frame__identity:has(.crit-frame__mark[aria-expanded="true"]) .crit-frame__title-track {
  transform: translateY(calc(-20px * var(--crit-ui)));
}

.crit-frame__title-track strong {
  align-content: center;
  display: block;
  flex: 0 0 calc(20px * var(--crit-ui));
  color: var(--frame-ink);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: calc(14px * var(--crit-ui));
  font-weight: 400;
  height: calc(20px * var(--crit-ui));
  line-height: calc(20px * var(--crit-ui));
  letter-spacing: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crit-frame__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: calc(6px * var(--crit-ui));
  justify-content: flex-end;
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
  flex: 1;
  min-height: 0;
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
.crit-frame__viewport iframe { background: oklch(97% 0.001 106.4); border: 0; height: 100%; inset: 0; position: absolute; width: 100%; }
.crit-frame__paused { color: var(--crit-muted); font: calc(10px * var(--crit-ui))/1.5 system-ui, sans-serif; padding: calc(24px * var(--crit-ui)); }
.crit-frame__comment-fallback { background: transparent; border: 0; cursor: crosshair; inset: 0; padding: 0; position: absolute; z-index: 3; }
.crit-comment-pin { align-items: center; background: #fff; border: 1px solid currentColor; border-radius: 999px; box-shadow: 0 2px 6px oklch(14.7% 0.004 49.3 / 18%); cursor: pointer; display: grid; height: calc(24px * var(--crit-ui)); justify-content: center; padding: calc(3px * var(--crit-ui)); position: absolute; transform: translate(-50%, -100%); transition: background 80ms ease, border-color 80ms ease, box-shadow 80ms ease; width: calc(24px * var(--crit-ui)); z-index: 4; }
.crit-comment-pin::after { background: currentColor; border-radius: 999px; content: ""; height: calc(7px * var(--crit-ui)); left: 50%; opacity: 0; position: absolute; top: 50%; transform: translate(-50%, -50%) scale(.35); transition: opacity 80ms ease, transform 80ms cubic-bezier(.22, 1, .36, 1); width: calc(7px * var(--crit-ui)); }
.crit-comment-pin svg { height: calc(16px * var(--crit-ui)); transform-origin: center; transition: opacity 80ms ease, transform 80ms cubic-bezier(.22, 1, .36, 1); width: calc(16px * var(--crit-ui)); }
.crit-comment-pin[data-active] { background: transparent; border-color: transparent; box-shadow: none; }
.crit-comment-pin[data-active]::after { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.crit-comment-pin[data-active] svg { opacity: 0; transform: scale(.35); }
.crit-comment-popover { animation: crit-comment-popover-in 90ms cubic-bezier(.22, 1, .36, 1) both; background: oklch(97% 0.001 106.4); border: 1px solid currentColor; border-radius: 10px; box-shadow: oklch(14.7% 0.004 49.3 / 24%) 0 12px 36px; font-family: system-ui, -apple-system, sans-serif; max-height: min(440px, calc(100vh - 24px)); overflow: auto; padding: 12px; position: absolute; transform-origin: top left; width: 332px; z-index: 5000; }
.crit-comment-popover[data-inline] { inset: auto; max-height: none; overflow: visible; position: relative; transform: none !important; width: 100%; }
@keyframes crit-comment-popover-in { from { opacity: 0; translate: 0 4px; } to { opacity: 1; translate: 0 0; } }
@media (prefers-reduced-motion: reduce) { .crit-comment-pin, .crit-comment-pin::after, .crit-comment-pin svg { transition: none; } .crit-comment-popover { animation: none; } }
.crit-comment-popover__header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 10px; }
.crit-comment-popover__header > span { align-items: center; display: flex; font-size: 12px; font-weight: 700; gap: 6px; }
.crit-comment-popover__header button, .crit-comment__actions button, .crit-comment__text-action { background: transparent; border: 0; border-radius: 4px; color: inherit; cursor: pointer; font: 600 11px/1.2 system-ui, sans-serif; padding: 5px 7px; }
.crit-comment-popover__header button:hover, .crit-comment__actions button:hover, .crit-comment__text-action:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
.crit-comment__messages { display: grid; gap: 8px; margin-bottom: 10px; }
.crit-comment__message { border-top: 1px solid color-mix(in oklch, currentColor 20%, transparent); color: #191918; padding-top: 8px; }
.crit-comment__message:first-child { border-top: 0; padding-top: 0; }
.crit-comment__message-header { align-items: baseline; display: flex; gap: 8px; }
.crit-comment__message-header strong { font-size: 11px; }
.crit-comment__message-header span { color: #77746c; font-size: 9px; }
.crit-comment__message p { font-size: 12px; line-height: 1.45; margin: 4px 0; white-space: pre-wrap; }
.crit-comment__text-action { color: #77746c; padding-left: 0; }
.crit-comment__composer, .crit-comment__message form { display: grid; gap: 8px; }
.crit-comment__composer textarea, .crit-comment__message textarea { background: #fff; border: 1px solid color-mix(in oklch, currentColor 35%, transparent); border-radius: 6px; color: #191918; font: 12px/1.45 system-ui, sans-serif; min-height: 72px; padding: 8px; resize: vertical; }
.crit-comment__actions { align-items: center; display: flex; justify-content: space-between; }
.crit-comment__actions button[type="submit"] { background: #191918; color: #fff; }
.crit-comment__actions button:disabled { cursor: default; opacity: .45; }

.crit-status-menu {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  gap: 16px;
  left: 0;
  pointer-events: auto;
  position: absolute;
  transform: scale(var(--crit-status-ui, 1));
  transform-origin: bottom left;
  width: max-content;
  z-index: 0;
}

.crit-canvas .crit-status-option {
  align-items: center;
  background: var(--status-shell);
  border: 0;
  border-radius: 8px;
  box-shadow: var(--status-stroke) 0 0 0 1px, 0 4px 12px rgba(25,25,24,.08);
  color: var(--status-ink);
  cursor: pointer;
  display: grid;
  font: 12px/16px system-ui, -apple-system, sans-serif;
  gap: 2px;
  grid-template-columns: 18px minmax(0, 1fr);
  height: 24px;
  padding: 0 12px 0 8px;
  text-align: left;
  width: max-content;
}
.crit-status-option:disabled { cursor: default; opacity: .45; }
.crit-status-option:hover, .crit-status-option[aria-checked="true"] { box-shadow: var(--status-ink) 0 0 0 1px, 0 6px 16px rgba(25,25,24,.13); }
.crit-status-option svg { height: 16px; width: 16px; }

.crit-note {
  background: oklch(97% 0.001 106.4);
  border: 0;
  border-radius: calc(8px * var(--crit-ui));
  box-shadow: #d8d5cc 0 0 0 calc(1px * var(--crit-ui));
  color: #191918;
  overflow: visible;
  position: absolute;
}
.crit-note::after {
  border-radius: inherit;
  box-shadow: oklch(100% 0 0 / 50%) 0 0 0 calc(1px * var(--crit-ui)) inset, oklch(100% 0 0 / 60%) 0 calc(1px * var(--crit-ui)) 0 inset;
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 2;
}
.crit-note textarea { background: transparent; border: 0; border-radius: inherit; color: #191918; display: block; font: 400 calc(14px * var(--crit-ui))/calc(20px * var(--crit-ui)) system-ui, -apple-system, sans-serif; min-height: calc(84px * var(--crit-ui)); outline: 0; overflow: hidden; padding: calc(12px * var(--crit-ui)); position: relative; resize: none; width: 100%; z-index: 1; }

.crit-note__select-shield {
  background: transparent;
  border: 0;
  cursor: var(--crit-canvas-cursor);
  inset: 0;
  padding: 0;
  position: absolute;
  z-index: 3;
}

.crit-selection {
  border-radius: inherit;
  box-shadow: 0 0 0 calc(1px * var(--selection-ui)) var(--selection-ink);
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
  height: calc(var(--selection-handle-size) * var(--selection-ui) * 1px);
  width: calc(var(--selection-handle-size) * var(--selection-ui) * 1px);
}
.crit-selection[data-handle-style="sides"] .crit-selection__handle[data-visible-handle] {
  height: auto;
}
.crit-selection__handle-shape {
  display: block;
  fill: var(--selection-ink);
  height: 100%;
  overflow: visible;
  width: 100%;
}
.crit-selection__side-handle-shape {
  fill: var(--selection-ink);
  height: calc(18px * var(--selection-ui));
  left: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: calc(4.95px * var(--selection-ui));
}
.crit-selection__handle-isolation { fill: #fff; }
.crit-selection__handle-accent { fill: var(--selection-handle-accent); }
.crit-selection__handle[data-resize-handle="north-west"] { cursor: ${resizeCursors.nwse}; left: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); top: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="north"] { cursor: ${resizeCursors.ns}; height: calc(12px * var(--selection-ui)); left: calc(8px * var(--selection-ui)); right: calc(8px * var(--selection-ui)); top: 0; transform: translateY(-50%); }
.crit-selection__handle[data-resize-handle="north-east"] { cursor: ${resizeCursors.nesw}; right: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); top: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="east"] { bottom: calc(8px * var(--selection-ui)); cursor: ${resizeCursors.ew}; right: 0; top: calc(8px * var(--selection-ui)); transform: translateX(50%); width: calc(12px * var(--selection-ui)); }
.crit-selection__handle[data-resize-handle="south-east"] { bottom: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); cursor: ${resizeCursors.nwse}; right: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="south"] { bottom: 0; cursor: ${resizeCursors.ns}; height: calc(12px * var(--selection-ui)); left: calc(8px * var(--selection-ui)); right: calc(8px * var(--selection-ui)); transform: translateY(50%); }
.crit-selection__handle[data-resize-handle="south-west"] { bottom: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); cursor: ${resizeCursors.nesw}; left: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="west"] { bottom: calc(8px * var(--selection-ui)); cursor: ${resizeCursors.ew}; left: 0; top: calc(8px * var(--selection-ui)); transform: translateX(-50%); width: calc(12px * var(--selection-ui)); }

.crit-help {
  --crit-help-inset: 8px;
  --crit-help-radius: 12px;
  background: oklch(97% 0.001 106.4);
  border-radius: var(--crit-help-radius);
  bottom: 16px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  display: grid;
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 400;
  gap: 8px;
  left: 16px;
  min-height: 88px;
  padding: var(--crit-help-inset);
  pointer-events: none;
  position: absolute;
  width: 320px;
  z-index: 4900;
}
.crit-help__header { align-items: start; display: flex; gap: 16px; justify-content: space-between; min-width: 0; }
.crit-help__title { color: var(--crit-help-title-ink, var(--crit-ink)); font-size: 13px; font-weight: 400; line-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crit-help__shortcut { background: var(--crit-help-shortcut-surface, oklch(95% 0.001 106.4)); border: 1px solid var(--crit-help-shortcut-border, var(--crit-line)); border-radius: calc(var(--crit-help-radius) - var(--crit-help-inset)); color: var(--crit-help-shortcut-ink, var(--crit-muted)); flex: 0 0 auto; font: 400 10px/16px system-ui, -apple-system, sans-serif; min-width: 24px; padding: 0 6px; text-align: center; white-space: nowrap; }
.crit-help__description { color: var(--crit-help-description-ink, var(--crit-muted)); font-size: 11px; font-weight: 400; line-height: 15px; margin: 0; }

.crit-frame:fullscreen {
  --crit-frame-chrome-height: 36px;
  --crit-ui: 1 !important;
  border-radius: 0;
  height: 100vh !important;
  left: 0 !important;
  top: 0 !important;
  width: 100vw !important;
}
.crit-frame:fullscreen .crit-frame__viewport { border-radius: 0; }

.crit-presence, .crit-save-state {
  border: 0;
  border-radius: 999px;
  font-family: system-ui, -apple-system, sans-serif;
  position: absolute;
  z-index: 1100;
}
.crit-presence { align-items: center; display: flex; flex-direction: row-reverse; right: 24px; top: 24px; }
.crit-presence__item { margin-left: -7px; position: relative; }
.crit-presence__item:last-child { margin-left: 0; }
.crit-presence__avatar { align-items: center; border: 2px solid #fff; border-radius: 999px; box-shadow: 0 1px 5px rgba(25,25,24,.18); color: #fff; display: flex; font-size: 11px; font-weight: 750; height: 30px; justify-content: center; letter-spacing: -.02em; width: 30px; }
.crit-presence__avatar[data-anonymous] { background: #77736b; }
.crit-presence__card { background: #191918; border-radius: 9px; box-shadow: 0 8px 24px rgba(25,25,24,.2); color: #fff; display: flex; flex-direction: column; font-size: 11px; gap: 4px; min-width: 190px; opacity: 0; padding: 10px 12px; pointer-events: none; position: absolute; right: 0; top: calc(100% + 8px); transform: translateY(-3px); transition: opacity 120ms ease, transform 120ms ease; visibility: hidden; z-index: 2; }
.crit-presence__item:hover .crit-presence__card, .crit-presence__item:focus-within .crit-presence__card { opacity: 1; pointer-events: auto; transform: translateY(0); visibility: visible; }
.crit-presence__card strong { font-size: 12px; }
.crit-presence__card span { color: #c9c5bd; }
.crit-presence__card p { line-height: 1.4; margin: 2px 0; }
.crit-presence__card code { color: #d9ff6f; font: 10px/1.4 "JetBrains Mono", ui-monospace, monospace; overflow-wrap: anywhere; }
.crit-presence__card a { color: #d9ff6f; overflow-wrap: anywhere; }
.crit-save-state { background: rgba(25,25,24,.86); bottom: 16px; color: #fff; cursor: default; font-size: 10px; padding: 7px 9px; right: 16px; text-transform: capitalize; }
.crit-save-state:enabled { cursor: pointer; }

.crit-identity-error { align-items: center; display: flex; flex-direction: column; gap: 10px; max-width: 620px; }
.crit-identity-error strong { color: #191918; font-size: 15px; }
.crit-identity-error p { margin: 0; }
.crit-identity-error button { background: #191918; border: 0; border-radius: 999px; color: #fff; cursor: pointer; font: inherit; padding: 8px 12px; }
.crit-identity-error details { max-width: 100%; }
.crit-identity-error summary { cursor: pointer; }
.crit-identity-error pre { background: #eeece7; border-radius: 8px; overflow: auto; padding: 10px; text-align: left; white-space: pre-wrap; }

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
.crit-context-menu-cluster { align-items: flex-start; display: flex; gap: 8px; }
.crit-context-menu[data-inline] { inset: auto; position: relative; }
.crit-context-menu-cluster .crit-context-menu--submenu { margin-top: 68px; }
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
  .crit-frame__mark, .crit-frame__action, .crit-frame__action[data-snapshotting] svg, .crit-frame__title-track, .crit-frame__title-edit-icon, .crit-frame__title-save { animation-duration: .01ms; transition-duration: .01ms; }
}
`
