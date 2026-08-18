import { resizeCursors } from "./resize-cursors.js"
import { MOVE_CANVAS_CURSOR } from "./move-cursor.js"
import { FRAME_CORNER_RADIUS } from "./frame-geometry.js"

export const critStyles = String.raw`
@import url("https://rsms.me/inter/inter.css");

.crit-overlay-container { display: contents; }

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
.crit-canvas:focus-visible { outline: 2px solid var(--crit-ink); outline-offset: -2px; }

.crit-note-thresholds {
  background: oklch(97% 0.001 106.4 / 92%);
  border: 1px solid var(--crit-line);
  border-radius: 8px;
  bottom: 16px;
  box-shadow: 0 2px 8px oklch(14.7% 0.004 49.3 / 12%);
  color: var(--crit-ink);
  display: grid;
  font: 400 10px/14px InterVariable, Inter, sans-serif;
  gap: 8px;
  left: 16px;
  padding: 9px 10px 10px;
  pointer-events: auto;
  position: absolute;
  width: 220px;
  z-index: 1000;
}
.crit-note-thresholds label {
  display: grid;
  gap: 4px 8px;
  grid-template-columns: 1fr auto;
}
.crit-note-thresholds header {
  align-items: center;
  border-bottom: 1px solid var(--crit-line);
  display: flex;
  justify-content: space-between;
  margin: -1px 0 1px;
  padding-bottom: 7px;
}
.crit-note-thresholds header strong {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.crit-note-thresholds span {
  letter-spacing: .06em;
  text-transform: uppercase;
}
.crit-note-thresholds output {
  color: var(--crit-muted);
  font-variant-numeric: tabular-nums;
}
.crit-note-thresholds input[type="range"] {
  accent-color: var(--crit-ink);
  grid-column: 1 / -1;
  margin: 0;
  width: 100%;
}
.crit-note-thresholds input[type="range"]:focus-visible {
  border-radius: 999px;
  outline: 2px solid color-mix(in oklch, var(--crit-color-p1, #777) 30%, transparent);
  outline-offset: 2px;
}

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

.crit-canvas__selection-marquee {
  --crit-selection-marquee-ink: var(--crit-color-t1, oklch(52% 0 none));
  --crit-selection-marquee-surface: color-mix(
    in oklch,
    var(--crit-color-p2, oklch(65% 0 none)) 10%,
    transparent
  );
  background-image:
    linear-gradient(to right, var(--crit-selection-marquee-ink) 0 9px, transparent 9px 12px, var(--crit-selection-marquee-ink) 12px calc(100% - 12px), transparent calc(100% - 12px) calc(100% - 9px), var(--crit-selection-marquee-ink) calc(100% - 9px)),
    linear-gradient(to right, var(--crit-selection-marquee-ink) 0 9px, transparent 9px 12px, var(--crit-selection-marquee-ink) 12px calc(100% - 12px), transparent calc(100% - 12px) calc(100% - 9px), var(--crit-selection-marquee-ink) calc(100% - 9px)),
    linear-gradient(to bottom, var(--crit-selection-marquee-ink) 0 9px, transparent 9px 12px, var(--crit-selection-marquee-ink) 12px calc(100% - 12px), transparent calc(100% - 12px) calc(100% - 9px), var(--crit-selection-marquee-ink) calc(100% - 9px)),
    linear-gradient(to bottom, var(--crit-selection-marquee-ink) 0 9px, transparent 9px 12px, var(--crit-selection-marquee-ink) 12px calc(100% - 12px), transparent calc(100% - 12px) calc(100% - 9px), var(--crit-selection-marquee-ink) calc(100% - 9px)),
    linear-gradient(var(--crit-selection-marquee-surface), var(--crit-selection-marquee-surface));
  background-position:
    0 4px,
    0 calc(100% - 4px),
    4px 0,
    calc(100% - 4px) 0,
    4px 4px;
  background-repeat: no-repeat;
  background-size:
    100% 1px,
    100% 1px,
    1px 100%,
    1px 100%,
    calc(100% - 8px) calc(100% - 8px);
  pointer-events: none;
  position: absolute;
  z-index: 950;
}

.crit-toolbar {
  align-items: center;
  background: oklch(97% 0.001 106.4);
  border-radius: 0 0 8px 0;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: oklch(26.9% 0 0);
  display: flex;
  font-family: InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
  gap: 8px;
  height: 40px;
  left: 0;
  letter-spacing: 0;
  max-width: 100%;
  padding: 0 8px 0 14px;
  pointer-events: auto;
  position: absolute;
  top: 0;
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
button.crit-toolbar__title {
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  letter-spacing: 0;
  line-height: 16px;
  margin: 0;
  padding: 0;
  text-align: left;
}
button.crit-toolbar__title:focus-visible { border-radius: 2px; outline: 2px solid currentColor; outline-offset: 2px; }

.crit-canvas-switcher-positioner { z-index: 5000; }
.crit-canvas-switcher {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: oklch(26.9% 0 0);
  font-family: InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
  letter-spacing: 0;
  min-width: 200px;
  outline: 0;
  padding: 4px;
}
.crit-canvas-switcher,
.crit-canvas-switcher * { box-sizing: border-box; }
.crit-canvas-switcher__item {
  align-items: center;
  border-radius: 5px;
  color: inherit;
  cursor: pointer;
  display: grid;
  font: 500 12px/16px InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
  gap: 8px;
  grid-template-columns: 12px minmax(0, 1fr);
  height: 32px;
  letter-spacing: 0;
  outline: 0;
  padding: 0 10px;
  user-select: none;
}
.crit-canvas-switcher__item[data-highlighted] { background: oklch(14.7% 0.004 49.3 / 8%); }
.crit-canvas-switcher__indicator { display: grid; height: 12px; place-items: center; width: 12px; }
.crit-canvas-switcher__indicator span { background: currentColor; border-radius: 999px; height: 6px; width: 6px; }
.crit-canvas-switcher__indicator--checkbox span { border-radius: 1px; height: 8px; width: 8px; }
.crit-canvas-switcher__label { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crit-canvas-switcher__separator { background: #d8d5cc; height: 1px; margin: 4px 6px; }

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

.crit-toolbar__group .crit-icon-button::before {
  content: "";
  inset: 0 -3px;
  position: absolute;
}

.crit-icon-button:hover, .crit-icon-button:focus-visible,
.crit-icon-button[aria-expanded="true"] { background: oklch(14.7% 0.004 49.3 / 8%); }
.crit-icon-button[aria-pressed="true"] { background: oklch(14.7% 0.004 49.3 / 8%); }
.crit-icon-button[aria-disabled="true"] { cursor: default; }
.crit-icon-button:disabled { cursor: default; opacity: .42; }
.crit-icon-button svg { height: 16px; width: 16px; }

.crit-arrangement-positioner { z-index: 5000; }
.crit-arrangement-popover {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
     oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
     oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: oklch(26.9% 0 0);
  display: grid;
  font-family: system-ui, -apple-system, sans-serif;
  gap: 4px;
  outline: 0;
  padding: 5px;
}
.crit-arrangement-popover,
.crit-arrangement-popover * { box-sizing: border-box; }
.crit-arrangement-popover__grid {
  display: grid;
  gap: 2px;
  grid-template-columns: repeat(6, 28px);
}
.crit-arrangement-popover__button {
  background: transparent;
  border: 0;
  border-radius: 5px;
  color: inherit;
  cursor: pointer;
  display: grid;
  height: 28px;
  padding: 0;
  place-items: center;
  width: 28px;
}
.crit-arrangement-popover__button:hover,
.crit-arrangement-popover__button:focus-visible,
.crit-arrangement-popover__button[data-highlighted] {
  background: oklch(14.7% 0.004 49.3 / 8%);
  outline: 0;
}
.crit-arrangement-popover__button[data-disabled] { cursor: default; opacity: .36; }
.crit-arrangement-popover__button svg { height: 16px; width: 16px; }

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
.crit-frame:focus-visible { outline: calc(2px * var(--crit-ui)) solid var(--frame-ink); outline-offset: calc(2px * var(--crit-ui)); }

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
  font-family: InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
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

.crit-frame__action {
  flex-basis: calc(22px * var(--crit-ui));
  height: var(--crit-frame-chrome-height);
  padding: calc(6px * var(--crit-ui)) calc(3px * var(--crit-ui));
  width: calc(22px * var(--crit-ui));
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
  font-family: inherit;
  font-size: calc(14px * var(--crit-ui));
  font-weight: 400;
  gap: calc(3px * var(--crit-ui));
  height: calc(20px * var(--crit-ui));
  line-height: calc(20px * var(--crit-ui));
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
  -webkit-touch-callout: default;
  background: transparent;
  border: 0;
  border-radius: 0;
  color: inherit;
  height: calc(20px * var(--crit-ui));
  line-height: calc(20px * var(--crit-ui));
  outline: 0;
  padding: 0;
  user-select: text;
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
  font-family: inherit;
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
  gap: 0;
  justify-content: flex-end;
  margin-inline: calc(-3px * var(--crit-ui));
}

.crit-frame__action[data-snapshotting] svg {
  animation: crit-frame-snapshot-pulse 700ms ease-in-out infinite alternate;
}

@keyframes crit-frame-snapshot-pulse {
  to { opacity: .45; transform: scale(.82); }
}

.crit-frame__viewport {
  background: var(--crit-frame-viewport-surface, oklch(99% 0 none));
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
.crit-frame__viewport iframe { background: var(--crit-frame-viewport-surface, oklch(99% 0 none)); border: 0; height: 100%; inset: 0; position: absolute; width: 100%; }
.crit-frame__paused { color: var(--crit-muted); font: calc(10px * var(--crit-ui))/1.5 system-ui, sans-serif; padding: calc(24px * var(--crit-ui)); }
.crit-frame__comment-fallback { background: transparent; border: 0; cursor: crosshair; inset: 0; padding: 0; position: absolute; z-index: 3; }
.crit-comment-pin { appearance: none; align-items: center; background: transparent; border: 0; box-shadow: none; cursor: pointer; display: grid; height: calc(24px * var(--crit-ui)); justify-content: center; padding: calc(3px * var(--crit-ui)); position: absolute; transform: translate(-50%, -100%); width: calc(24px * var(--crit-ui)); z-index: 4; }
.crit-comment-pin:focus-visible { outline: calc(2px * var(--crit-ui)) solid currentColor; outline-offset: calc(2px * var(--crit-ui)); }
.crit-comment-pin svg { display: block; height: calc(18px * var(--crit-ui)); width: calc(18px * var(--crit-ui)); }
.crit-comment-popover-positioner { z-index: 5000; }
.crit-comment-popover-positioner[data-sticky] { left: var(--crit-comment-left) !important; position: absolute !important; top: var(--crit-comment-top) !important; transform: scale(var(--crit-comment-scale)) !important; transform-origin: top left !important; }
.crit-comment-popover { animation: crit-comment-popover-in 90ms cubic-bezier(.22, 1, .36, 1) both; background: oklch(97% 0.001 106.4); border: 1px solid currentColor; border-radius: 10px; box-shadow: oklch(14.7% 0.004 49.3 / 24%) 0 12px 36px; box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; max-height: min(440px, calc(100vh - 24px)); outline: 0; overflow: auto; padding: 12px; position: relative; transform-origin: var(--transform-origin, top left); width: 332px; z-index: 5000; }
.crit-comment-popover[data-inline] { inset: auto; max-height: none; overflow: visible; position: relative; transform: none !important; width: 100%; }
@keyframes crit-comment-popover-in { from { opacity: 0; translate: 0 4px; } to { opacity: 1; translate: 0 0; } }
@media (prefers-reduced-motion: reduce) { .crit-comment-popover { animation: none; } }
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

.crit-status-positioner {
  height: 0;
  left: 0 !important;
  position: absolute !important;
  top: 0 !important;
  transform: none !important;
  width: 0;
  z-index: -1;
}

.crit-status-menu {
  align-items: flex-start;
  bottom: var(--crit-status-frame-gap, 0);
  display: flex;
  flex-direction: column;
  gap: 16px;
  left: 0;
  outline: 0;
  pointer-events: auto;
  position: absolute;
  transform: scale(var(--crit-status-ui, 1));
  transform-origin: bottom left;
  width: max-content;
}

.crit-canvas .crit-status-option,
.crit-overlay-container .crit-status-option {
  align-items: center;
  background: var(--status-shell);
  border: 0;
  border-radius: 8px;
  box-shadow: var(--status-stroke) 0 0 0 1px, 0 4px 12px rgba(25,25,24,.08);
  box-sizing: border-box;
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
.crit-status-option[data-disabled] { cursor: default; opacity: .45; }
.crit-status-option:hover, .crit-status-option[data-highlighted] { box-shadow: var(--status-ink) 0 0 0 1px, 0 6px 16px rgba(25,25,24,.13); }
.crit-status-option svg { height: 16px; width: 16px; }

.crit-note {
  --crit-note-corner-size: calc(28.5px * var(--crit-ui));
  --crit-note-mask-overlap: calc(1px * var(--crit-ui));
  --crit-note-outline: var(--crit-note-ink);
  --crit-note-outline-spread: calc(.5px * var(--crit-ui));
  background: transparent;
  border: 0;
  border-radius: calc(8px * var(--crit-ui));
  color: var(--crit-note-text);
  filter:
    drop-shadow(0 calc(2px * var(--crit-ui)) calc(4px * var(--crit-ui)) color-mix(in oklch, var(--crit-note-ink) 10%, transparent))
    drop-shadow(0 0 calc(.5px * var(--crit-ui)) color-mix(in oklch, var(--crit-note-ink) 20%, transparent));
  overflow: visible;
  position: absolute;
}
.crit-note[data-selected], .crit-note:focus-visible {
  --crit-note-outline: var(--crit-color-t2, oklch(28% 0 none));
  --crit-note-outline-spread: calc(1px * var(--crit-ui));
  outline: 0;
}
.crit-note[data-mode="collapsed"] { background: transparent; box-shadow: none; }
.crit-note[data-mode="collapsed"]:focus-visible { outline: 0; }
.crit-note[data-mode="expanded"] { overflow: auto; overscroll-behavior: contain; }
.crit-note::after {
  background: var(--crit-note-surface);
  border: calc(1px * var(--crit-ui)) solid var(--crit-note-outline);
  border-radius: inherit;
  box-shadow: var(--crit-note-outline) 0 0 0 var(--crit-note-outline-spread);
  box-sizing: border-box;
  content: "";
  inset: 0;
  -webkit-mask: linear-gradient(#fff 0 0) top / 100% calc(100% - var(--crit-note-corner-size) + var(--crit-note-mask-overlap)) no-repeat, linear-gradient(#fff 0 0) bottom left / calc(100% - var(--crit-note-corner-size) + var(--crit-note-mask-overlap)) var(--crit-note-corner-size) no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28.5 28.5'%3E%3Cpath fill='white' d='M0 0h28c0 2.21-1.79 4-4 4H12c-4.42 0-8 3.58-8 8v12c0 2.21-1.79 4-4 4Z'/%3E%3C/svg%3E") bottom right / var(--crit-note-corner-size) var(--crit-note-corner-size) no-repeat;
  mask: linear-gradient(#fff 0 0) top / 100% calc(100% - var(--crit-note-corner-size) + var(--crit-note-mask-overlap)) no-repeat, linear-gradient(#fff 0 0) bottom left / calc(100% - var(--crit-note-corner-size) + var(--crit-note-mask-overlap)) var(--crit-note-corner-size) no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28.5 28.5'%3E%3Cpath fill='white' d='M0 0h28c0 2.21-1.79 4-4 4H12c-4.42 0-8 3.58-8 8v12c0 2.21-1.79 4-4 4Z'/%3E%3C/svg%3E") bottom right / var(--crit-note-corner-size) var(--crit-note-corner-size) no-repeat;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}
.crit-note[data-mode="collapsed"]::after { display: none; }
.crit-note textarea { -webkit-touch-callout: default; background: transparent; border: 0; border-radius: inherit; color: var(--crit-note-text); display: block; font: 400 calc(14px * var(--crit-ui))/calc(20px * var(--crit-ui)) system-ui, -apple-system, sans-serif; hyphens: auto; min-height: calc(84px * var(--crit-ui)); outline: 0; overflow: hidden; overflow-wrap: anywhere; padding: calc(12px * var(--crit-ui)); position: relative; resize: none; text-wrap: pretty; user-select: text; white-space: pre-wrap; width: 100%; z-index: 1; }
.crit-note[data-mode="expanded"] textarea { padding-right: calc(40px * var(--crit-ui)); }

.crit-note__interaction-band {
  bottom: 0;
  cursor: var(--crit-canvas-cursor);
  height: var(--crit-note-corner-size);
  left: 0;
  position: absolute;
  width: 100%;
  z-index: 1;
}

.crit-note__collapsed {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--crit-note-ink);
  cursor: var(--crit-canvas-cursor);
  display: grid;
  height: 100%;
  justify-items: center;
  padding: 0;
  width: 100%;
}
.crit-note__collapsed svg {
  height: calc(18px * var(--crit-ui));
  transform-origin: center;
  transition: transform 90ms ease-out;
  width: calc(18px * var(--crit-ui));
}
.crit-note__collapsed:hover svg { transform: scale(1.08); }
.crit-note__collapsed:focus-visible { outline: 0; }
.crit-note__collapsed:focus-visible svg {
  filter: drop-shadow(0 0 calc(3px * var(--crit-ui)) color-mix(in oklch, var(--crit-color-p1, #191918) 30%, transparent));
}

.crit-note__close {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  height: calc(28px * var(--crit-ui));
  justify-content: center;
  padding: 0;
  position: absolute;
  right: calc(4px * var(--crit-ui));
  top: calc(4px * var(--crit-ui));
  width: calc(28px * var(--crit-ui));
  z-index: 4;
}
.crit-note__close:hover { transform: scale(1.06); }
.crit-note__close:focus-visible {
  border-radius: 50%;
  outline: calc(2px * var(--crit-ui)) solid color-mix(in oklch, var(--crit-color-p1, #191918) 30%, transparent);
  outline-offset: 0;
}
.crit-note__close svg { height: calc(18px * var(--crit-ui)); width: calc(18px * var(--crit-ui)); }

.crit-note__corner {
  bottom: 0;
  display: block;
  height: var(--crit-note-corner-size);
  pointer-events: none;
  position: absolute;
  right: 0;
  shape-rendering: geometricPrecision;
  width: var(--crit-note-corner-size);
  z-index: 2;
}

.crit-note__select-shield {
  background: transparent;
  border: 0;
  cursor: var(--crit-canvas-cursor);
  inset: 0 0 var(--crit-note-corner-size);
  padding: 0;
  position: absolute;
  z-index: 3;
}

@media (prefers-reduced-motion: reduce) {
  .crit-note__collapsed svg { transition: none; }
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
  align-content: start;
  background: var(--crit-help-surface, var(--crit-color-s2, #f5f5f4));
  border-radius: 0 8px 0 0;
  bottom: 0;
  box-sizing: border-box;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  display: grid;
  font-family: InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
  font-weight: 400;
  gap: 8px;
  left: 0;
  letter-spacing: 0;
  max-width: 100%;
  min-height: 92px;
  padding: 10px 12px 14px 14px;
  pointer-events: none;
  position: absolute;
  width: 335px;
  z-index: 4900;
}
.crit-help__header { align-items: start; display: flex; gap: 16px; justify-content: space-between; min-height: 20px; min-width: 0; }
.crit-help__title {
  color: var(--crit-help-title-ink, var(--crit-color-t2, oklch(28% 0 0)));
  font: 400 14px/20px InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crit-help__shortcut { background: var(--crit-help-shortcut-surface, var(--crit-color-s1, #fcfcfc)); border: 0; border-radius: 2px; box-shadow: var(--crit-help-shortcut-border, #29292933) 0 0 0 .5px; box-sizing: border-box; color: var(--crit-help-shortcut-ink, var(--crit-color-t1, oklch(52% 0 0))); flex: 0 0 auto; font: 400 12px/20px "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; height: 20px; padding: 0 8px; position: relative; text-align: center; top: 1px; white-space: nowrap; }
.crit-help__description, .crit-help__availability {
  color: var(--crit-help-description-ink, var(--crit-color-t1, oklch(52% 0 0)));
  font: 400 14px/20px InterVariable, Inter, sans-serif;
  font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1;
  font-optical-sizing: none;
  font-variation-settings: "opsz" 14;
  letter-spacing: 0;
  margin: 0;
  max-width: 307px;
}

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

.crit-save-state {
  border: 0;
  border-radius: 999px;
  font-family: system-ui, -apple-system, sans-serif;
  position: absolute;
  z-index: 1100;
}
.crit-presence {
  background: var(--crit-color-c3, oklch(92.8% 0 0));
  border-radius: 4px;
  flex: 0 0 auto;
  height: 24px;
  isolation: isolate;
  overflow: visible;
  position: relative;
  transition: width 160ms cubic-bezier(.2, .8, .2, 1);
  width: var(--crit-presence-collapsed-width);
}
.crit-presence:hover, .crit-presence:focus-within {
  width: var(--crit-presence-expanded-width);
}
.crit-presence__item {
  height: 22px;
  left: 0;
  opacity: 1;
  position: absolute;
  top: 1px;
  transform: translate3d(var(--crit-presence-collapsed-x), 0, 0) scale(var(--crit-presence-collapsed-scale));
  transform-origin: left center;
  transition:
    opacity 90ms ease-out,
    transform 160ms cubic-bezier(.2, .8, .2, 1);
  width: 22px;
  z-index: var(--crit-presence-layer);
}
.crit-presence__item[data-collapsed-hidden] { opacity: 0; }
.crit-presence:hover .crit-presence__item,
.crit-presence:focus-within .crit-presence__item {
  opacity: 1;
  transform: translate3d(var(--crit-presence-expanded-x), 0, 0) scale(1);
}
.crit-presence__avatar {
  align-items: center;
  appearance: none;
  border: 0;
  border-radius: 3px;
  box-shadow: var(--crit-color-c3, oklch(92.8% 0 0)) 0 0 0 .5px;
  box-sizing: border-box;
  color: #fff;
  cursor: pointer;
  display: flex;
  font: 400 14px/20px InterVariable, Inter, sans-serif;
  height: 22px;
  justify-content: center;
  letter-spacing: 0;
  padding: 0;
  width: 22px;
}
.crit-presence__glyph {
  font-family: InterVariable, Inter, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  pointer-events: none;
  transform: scale(var(--crit-presence-glyph-scale));
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.2, .8, .2, 1);
}
.crit-presence:hover .crit-presence__glyph,
.crit-presence:focus-within .crit-presence__glyph { transform: scale(1); }
.crit-presence__avatar[data-anonymous] { background: var(--crit-color-t1, oklch(52% 0 0)); }
.crit-presence__avatar:focus-visible { outline: 2px solid var(--crit-color-t2, oklch(28% 0 0)); outline-offset: 1px; }
.crit-presence__overflow {
  color: var(--crit-color-t1, oklch(52% 0 0));
  font: 400 10px/20px InterVariable, Inter, sans-serif;
  height: 20px;
  left: 30px;
  opacity: 1;
  pointer-events: none;
  position: absolute;
  text-align: center;
  top: 2px;
  transition: opacity 80ms ease-out;
  width: 18px;
}
.crit-presence:hover .crit-presence__overflow,
.crit-presence:focus-within .crit-presence__overflow { opacity: 0; }
.crit-presence__positioner { height: var(--positioner-height); max-width: var(--available-width); transition: top 160ms cubic-bezier(.2, .8, .2, 1), left 160ms cubic-bezier(.2, .8, .2, 1), right 160ms cubic-bezier(.2, .8, .2, 1), bottom 160ms cubic-bezier(.2, .8, .2, 1), transform 160ms cubic-bezier(.2, .8, .2, 1); width: var(--positioner-width); z-index: 5000; }
.crit-presence__positioner[data-instant] { transition: none; }
.crit-presence__card { background: var(--crit-color-s2, #f5f5f4); border-radius: 8px; box-shadow: #ffffff80 0 0 0 1px inset, #fff 0 1px 0 inset, #0c0a091a 0 2px 4px, #0c0a0933 0 0 0 .5px; height: var(--popup-height, auto); max-width: 260px; min-width: 188px; opacity: 1; overflow: clip; padding: 0; position: relative; transform: translateY(0); transition: width 160ms cubic-bezier(.2, .8, .2, 1), height 160ms cubic-bezier(.2, .8, .2, 1), opacity 120ms ease, transform 120ms ease; width: var(--popup-width, auto); }
.crit-presence__card[data-starting-style], .crit-presence__card[data-ending-style] { opacity: 0; transform: translateY(-3px); }
.crit-presence__card[data-side="top"][data-starting-style], .crit-presence__card[data-side="top"][data-ending-style] { transform: translateY(3px); }
.crit-presence__card[data-instant] { transition: none; }
.crit-presence__viewport { box-sizing: border-box; height: 100%; overflow: clip; padding: 6px 10px; position: relative; width: 100%; }
.crit-presence__viewport > [data-current], .crit-presence__viewport > [data-previous] { opacity: 1; transform: translateX(0); transition: opacity 80ms ease-out, transform 160ms cubic-bezier(.2, .8, .2, 1); width: calc(var(--popup-width) - 20px); }
.crit-presence__viewport[data-activation-direction~="right"] > [data-previous][data-ending-style], .crit-presence__viewport[data-activation-direction~="left"] > [data-current][data-starting-style] { opacity: 0; transform: translateX(-8px); }
.crit-presence__viewport[data-activation-direction~="left"] > [data-previous][data-ending-style], .crit-presence__viewport[data-activation-direction~="right"] > [data-current][data-starting-style] { opacity: 0; transform: translateX(8px); }
.crit-presence__viewport[data-instant] > [data-current], .crit-presence__viewport[data-instant] > [data-previous] { transition: none; }
.crit-presence__content { display: flex; flex-direction: column; }
.crit-presence__name { color: var(--crit-color-t2, oklch(28% 0 0)); font: 400 14px/20px InterVariable, Inter, sans-serif; }
.crit-presence__secondary { color: var(--crit-color-t1, oklch(52% 0 0)); font: 400 12px/16px InterVariable, Inter, sans-serif; overflow-wrap: anywhere; }
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

.crit-context-menu__positioner { outline: 0; z-index: 5000; }
.crit-context-menu__positioner--submenu { z-index: 5001; }
.crit-context-menu {
  background: oklch(97% 0.001 106.4);
  box-sizing: border-box;
  border-radius: 8px;
  box-shadow: oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px, oklch(14.7% 0.004 49.3 / 18%) 0 10px 30px;
  color: #191918;
  display: grid;
  font: 500 12px/16px system-ui, -apple-system, sans-serif;
  gap: 0;
  padding: 4px;
  outline: 0;
  position: relative;
  width: 192px;
  z-index: 5000;
}
.crit-context-menu,
.crit-context-menu * { box-sizing: border-box; }
.crit-context-menu button, .crit-context-menu a {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 5px;
  box-shadow: none;
  color: #191918;
  cursor: pointer;
  display: flex;
  font: 500 12px/16px system-ui, -apple-system, sans-serif;
  height: 28px;
  justify-content: space-between;
  padding: 0 8px;
  text-align: left;
  text-decoration: none;
  width: 100%;
}
.crit-context-menu__arrow { color: #77746c; font-size: 16px; margin-left: auto; }
.crit-context-menu__detail { color: #77746c; font-size: 10px; font-variant-numeric: tabular-nums; margin-left: 8px; }
.crit-context-menu--submenu { z-index: 5001; }
.crit-context-menu-cluster { align-items: flex-start; display: flex; gap: 8px; position: relative; width: 192px; }
.crit-context-menu-specimen__anchor { height: 0; width: 192px; }
.crit-context-menu button:hover, .crit-context-menu button:focus-visible,
.crit-context-menu a:hover, .crit-context-menu a:focus-visible,
.crit-context-menu__item[data-highlighted] {
  background: var(--crit-color-s1, oklch(99% 0 none));
  outline: 0;
}
.crit-context-menu__item[data-disabled] { cursor: default; opacity: .42; }
.crit-context-menu button[data-tone="danger"],
.crit-context-menu__item[data-tone="danger"] { color: #b42318; }
.crit-context-menu__swatches {
  align-items: center;
  display: flex;
  gap: 5px;
  padding: 4px;
}
.crit-context-menu button.crit-context-menu__swatch {
  background: var(--crit-swatch, currentColor);
  border: 0;
  border-radius: 2px;
  flex: 0 0 24px;
  height: 24px;
  padding: 0;
  width: 24px;
}
.crit-context-menu button.crit-context-menu__swatch:focus-visible {
  background: var(--crit-swatch, currentColor);
  outline: 2px solid var(--crit-swatch-selected-shadow, currentColor);
  outline-offset: 1px;
}
.crit-context-menu button.crit-context-menu__swatch[data-selected] {
  box-shadow: 0 0 0 1px var(--crit-swatch-selected-shadow, currentColor);
}

.crit-dialog-backdrop {
  background: rgba(25, 25, 24, .28);
  inset: 0;
  min-height: 100dvh;
  opacity: 1;
  position: fixed;
  transition: opacity 120ms ease;
  z-index: 5100;
}
.crit-dialog-backdrop[data-starting-style],
.crit-dialog-backdrop[data-ending-style] { opacity: 0; }
.crit-confirmation-dialog {
  background: oklch(98.5% 0 none);
  border-radius: 10px;
  box-shadow: rgba(25, 25, 24, .22) 0 16px 48px, rgba(25, 25, 24, .2) 0 0 0 .5px;
  color: #191918;
  display: grid;
  font-family: system-ui, -apple-system, sans-serif;
  gap: 18px;
  left: 50%;
  max-width: 380px;
  outline: 0;
  padding: 20px;
  position: fixed;
  top: 50%;
  transform: translate(-50%, -50%) scale(1);
  transition: opacity 100ms ease-out, transform 100ms ease-out;
  width: calc(100% - 48px);
  z-index: 5101;
}
.crit-confirmation-dialog[data-starting-style],
.crit-confirmation-dialog[data-ending-style] {
  opacity: 0;
  transform: translate(-50%, -50%) scale(.98);
}
.crit-confirmation-dialog__intro { display: grid; gap: 6px; }
.crit-confirmation-dialog h2 { font-size: 16px; margin: 0; }
.crit-confirmation-dialog p { color: #68655e; font: 400 13px/1.5 system-ui, -apple-system, sans-serif; margin: 0; }
.crit-confirmation-dialog__actions { display: flex; gap: 8px; justify-content: flex-end; }
.crit-confirmation-dialog__actions button {
  background: transparent;
  border: 1px solid #d8d5cc;
  border-radius: 6px;
  color: #191918;
  cursor: pointer;
  font: 600 12px/1 system-ui, -apple-system, sans-serif;
  height: 34px;
  padding: 0 12px;
}
.crit-confirmation-dialog__actions button:hover,
.crit-confirmation-dialog__actions button:focus-visible { background: #eeece7; outline: 0; }
.crit-confirmation-dialog__actions button[data-tone="danger"] { background: #b42318; border-color: #b42318; color: #fff; }
.crit-confirmation-dialog__actions button[data-tone="danger"]:hover,
.crit-confirmation-dialog__actions button[data-tone="danger"]:focus-visible { background: #8f1d14; }
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
.crit-new-frame-dialog--popup {
  left: 50%;
  outline: 0;
  position: fixed;
  top: 50%;
  transform: translate(-50%, -50%);
  width: calc(100% - 48px);
  z-index: 5101;
}
.crit-new-frame-dialog__form { display: grid; gap: 16px; }
.crit-new-frame-dialog h2 { font-size: 16px; margin: 0; }
.crit-new-frame-dialog__description { color: #68655e; font: 400 13px/1.5 system-ui, -apple-system, sans-serif; margin: -8px 0 0; }
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

@supports (-webkit-touch-callout: none) {
  .crit-dialog-backdrop { position: absolute; }
}

@media (max-width: 640px) {
  .crit-save-state { bottom: 12px; right: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .crit-frame__mark, .crit-frame__action, .crit-frame__action[data-snapshotting] svg, .crit-frame__title-track, .crit-frame__title-edit-icon, .crit-frame__title-save { animation-duration: .01ms; transition-duration: .01ms; }
  .crit-presence, .crit-presence__card, .crit-presence__glyph, .crit-presence__item, .crit-presence__overflow, .crit-presence__positioner, .crit-presence__viewport > [data-current], .crit-presence__viewport > [data-previous] { transition-duration: .01ms; }
}
`
