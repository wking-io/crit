import { MOVE_CANVAS_CURSOR } from "./move-cursor.js"
import { resizeCursors } from "./resize-cursors.js"

const INTER = "InterVariable, Inter, sans-serif"
const INTER_LOCK =
  'font-feature-settings: "calt" 1, "case" 1, "ss02" 1, "tnum" 1, "ss03" 1; font-optical-sizing: none; font-variation-settings: "opsz" 14; letter-spacing: 0'
const FRAME_CORNER_RADIUS = 8

export const critStyles = String.raw`
@import url("https://rsms.me/inter/inter.css");

.crit-host, .crit-replica {
  height: 100%;
  min-height: 100dvh;
  width: 100%;
}
.crit-canvas {
  height: 100%;
  min-height: 100%;
  width: 100%;
}

.crit-overlay-container { display: contents; }

.crit-root, .crit-canvas, .crit-replica, .crit-host {
  font-family: ${INTER};
  ${INTER_LOCK};
}

.crit-canvas {
  --crit-ink: #191918;
  --crit-paper: oklch(98.5% 0 none);
  --crit-line: #d8d5cc;
  --crit-muted: #77746c;
  --crit-accent: #ff5c35;
  --crit-color-s1: oklch(99% 0 none);
  --crit-color-s2: oklch(97.5% 0 none);
  --crit-color-c1: oklch(95.25% 0 none);
  --crit-color-c2: oklch(94% 0 none);
  --crit-color-c3: oklch(92.75% 0 none);
  --crit-color-p1: oklch(67% 0 none);
  --crit-color-p2: oklch(65% 0 none);
  --crit-color-t1: oklch(52% 0 none);
  --crit-color-t2: oklch(28% 0 none);
  background: var(--crit-paper);
  color: #191918;
  isolation: isolate;
  overflow: clip;
  overscroll-behavior: none;
  overscroll-behavior-x: none;
}

.crit-canvas, .crit-canvas * { box-sizing: border-box; }
.crit-canvas button, .crit-canvas input, .crit-canvas textarea { font: inherit; }
.crit-canvas:focus-visible { outline: 2px solid var(--crit-ink); outline-offset: -2px; }

.crit-canvas__plane {
  height: 0;
  left: 0;
  position: absolute;
  top: 0;
  transform-origin: 0 0;
  width: 0;
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

.crit-review-chrome {
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 1000;
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
.crit-toolbar__title svg {
  display: block;
  flex: 0 0 16px;
  height: 16px;
  width: 16px;
}
.crit-toolbar__title[data-saving] { overflow: visible; }
.crit-toolbar__title[data-saving] svg {
  animation: crit-loader-spin 800ms linear infinite;
  transform-origin: 50% 50%;
}
@keyframes crit-loader-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
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

.crit-toolbar-overlay-positioner { z-index: 5000; }
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
.crit-canvas-switcher__label { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crit-canvas-switcher__separator { background: #d8d5cc; height: 1px; margin: 4px 6px; }

.crit-toolbar__group {
  align-items: center;
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 6px;
}

.crit-toolbar__divider {
  align-self: stretch;
  background: oklch(14.7% 0.004 49.3 / 20%);
  flex: 0 0 .5px;
  min-height: 16px;
  width: .5px;
}

.crit-icon-button,
.crit-toolbar__action {
  background: transparent;
  border: 0;
  border-radius: 2px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  position: relative;
}

.crit-icon-button {
  display: grid;
  flex: 0 0 auto;
  height: 24px;
  padding: 0;
  place-items: center;
  text-decoration: none;
  width: 24px;
}

.crit-toolbar__action {
  border-radius: 6px;
  font: 500 12px/16px ${INTER};
  ${INTER_LOCK};
  height: 28px;
  padding: 0 8px;
  white-space: nowrap;
}

.crit-icon-button:hover, .crit-icon-button:focus-visible,
.crit-icon-button[aria-expanded="true"],
.crit-icon-button[aria-pressed="true"],
.crit-toolbar__action:hover,
.crit-toolbar__action:focus-visible {
  background: oklch(14.7% 0.004 49.3 / 8%);
}
.crit-icon-button:disabled,
.crit-toolbar__action:disabled { cursor: default; opacity: .42; }
.crit-toolbar__group .crit-icon-button::before {
  content: "";
  inset: 0 -3px;
  position: absolute;
}
.crit-icon-button svg { height: 16px; width: 16px; }

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
  font-family: ${INTER};
  ${INTER_LOCK};
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

.crit-toolbar form {
  align-items: center;
  display: flex;
  gap: 6px;
}
.crit-toolbar label {
  align-items: center;
  color: var(--crit-muted);
  display: flex;
  font: 500 12px/16px ${INTER};
  ${INTER_LOCK};
  gap: 6px;
}
.crit-toolbar input {
  background: #fff;
  border: 1px solid var(--crit-line);
  border-radius: 6px;
  color: var(--crit-ink);
  font: 13px/20px ${INTER};
  ${INTER_LOCK};
  height: 28px;
  outline: 0;
  padding: 0 8px;
  width: 148px;
}
.crit-toolbar input:focus { border-color: var(--crit-ink); }
.crit-toolbar form button {
  background: var(--crit-ink);
  border: 0;
  border-radius: 6px;
  color: var(--crit-paper);
  cursor: pointer;
  font: 600 12px/1 ${INTER};
  ${INTER_LOCK};
  height: 28px;
  padding: 0 10px;
}

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
.crit-frame[data-offscreen] .crit-frame__viewport iframe,
.crit-frame__viewport iframe[data-paused="true"] { content-visibility: hidden; pointer-events: none; visibility: hidden; }
.crit-frame__paused,
.crit-frame__viewport > [role="status"],
.crit-frame__viewport > [role="alert"] {
  color: var(--crit-muted);
  font: calc(10px * var(--crit-ui))/1.5 ${INTER};
  ${INTER_LOCK};
  inset: 0;
  padding: calc(24px * var(--crit-ui));
  position: absolute;
}

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
  font: 12px/16px ${INTER};
  ${INTER_LOCK};
  gap: 2px;
  grid-template-columns: 18px max-content;
  height: 24px;
  overflow: hidden;
  padding: 0 12px 0 8px;
  text-align: left;
  white-space: nowrap;
  width: max-content;
}
.crit-status-option[data-disabled] { cursor: default; opacity: .45; }
.crit-status-option:hover, .crit-status-option[data-highlighted] { box-shadow: var(--status-ink) 0 0 0 1px, 0 6px 16px rgba(25,25,24,.13); }
.crit-status-option svg { height: 16px; width: 16px; }

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
.crit-selection__handle-shape {
  display: block;
  fill: var(--selection-ink);
  height: 100%;
  overflow: visible;
  width: 100%;
}
.crit-selection__handle-isolation { fill: #fff; }
.crit-selection__handle-accent { fill: var(--selection-handle-accent); }
.crit-selection__handle[data-resize-handle="north-west"] { cursor: ${resizeCursors.nwse}; left: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); top: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="north-east"] { cursor: ${resizeCursors.nesw}; right: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); top: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="south-east"] { bottom: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); cursor: ${resizeCursors.nwse}; right: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }
.crit-selection__handle[data-resize-handle="south-west"] { bottom: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); cursor: ${resizeCursors.nesw}; left: calc(var(--selection-handle-offset) * var(--selection-ui) * -1px); }

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
  text-wrap: pretty;
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
  background: rgba(25,25,24,.86);
  border: 0;
  border-radius: 999px;
  bottom: 16px;
  color: #fff;
  cursor: default;
  font-family: ${INTER};
  ${INTER_LOCK};
  font-size: 10px;
  padding: 7px 9px;
  position: absolute;
  right: 16px;
  text-transform: capitalize;
  z-index: 1100;
}

.crit-message { background: var(--crit-paper); color: #68655e; font: 500 12px/1.7 ${INTER}; ${INTER_LOCK}; }

.crit-replica {
  isolation: isolate;
  position: relative;
}

.crit-replica__alerts {
  display: grid;
  gap: 8px;
  left: 16px;
  max-width: min(420px, calc(100% - 32px));
  pointer-events: none;
  position: absolute;
  top: 52px;
  z-index: 1200;
}
.crit-replica__alerts p {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: #191918;
  font: 500 12px/1.5 ${INTER};
  ${INTER_LOCK};
  margin: 0;
  padding: 8px 12px;
  pointer-events: auto;
}

.crit-replica__presence {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: oklch(26.9% 0 0);
  font: 400 12px/16px ${INTER};
  ${INTER_LOCK};
  padding: 6px 10px;
  position: absolute;
  right: 12px;
  top: 8px;
  z-index: 1100;
}
.crit-replica__presence ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.crit-replica__sync {
  pointer-events: none;
}
.crit-replica__sync ul {
  bottom: 44px;
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 0;
  max-width: min(360px, calc(100% - 32px));
  padding: 0;
  position: absolute;
  right: 16px;
  z-index: 1100;
}
.crit-replica__sync li {
  background: oklch(97% 0.001 106.4);
  border-radius: 8px;
  box-shadow:
    #ffffff80 0 0 0 1px inset,
    #fff 0 1px 0 inset,
    oklch(14.7% 0.004 49.3 / 10%) 0 2px 4px,
    oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px;
  color: #191918;
  font: 500 11px/1.45 ${INTER};
  ${INTER_LOCK};
  padding: 7px 9px;
}

.crit-context-menu__positioner { outline: 0; z-index: 5000; }
.crit-context-menu__positioner--submenu { z-index: 5001; }
.crit-context-menu {
  background: oklch(97% 0.001 106.4);
  box-sizing: border-box;
  border-radius: 8px;
  box-shadow: oklch(14.7% 0.004 49.3 / 20%) 0 0 0 .5px, oklch(14.7% 0.004 49.3 / 18%) 0 10px 30px;
  color: #191918;
  display: grid;
  font: 500 12px/16px ${INTER};
  ${INTER_LOCK};
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
  font: 500 12px/16px ${INTER};
  ${INTER_LOCK};
  height: 28px;
  justify-content: space-between;
  padding: 0 8px;
  text-align: left;
  text-decoration: none;
  width: 100%;
}
.crit-context-menu__arrow { color: #77746c; font-size: 16px; margin-left: auto; }
.crit-context-menu__check { flex: 0 0 auto; font-size: 16px; height: 16px; margin-left: auto; width: 16px; }
.crit-context-menu__check svg { display: block; height: 16px; width: 16px; }
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
  font-family: ${INTER};
  ${INTER_LOCK};
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
.crit-confirmation-dialog p { color: #68655e; font: 400 13px/1.5 ${INTER}; ${INTER_LOCK}; margin: 0; }
.crit-confirmation-dialog__actions { display: flex; gap: 8px; justify-content: flex-end; }
.crit-confirmation-dialog__actions button {
  background: transparent;
  border: 1px solid #d8d5cc;
  border-radius: 6px;
  color: #191918;
  cursor: pointer;
  font: 600 12px/1 ${INTER};
  ${INTER_LOCK};
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
  font-family: ${INTER};
  ${INTER_LOCK};
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
.crit-new-frame-dialog__description { color: #68655e; font: 400 13px/1.5 ${INTER}; ${INTER_LOCK}; margin: -8px 0 0; }
.crit-new-frame-dialog label { display: grid; font-size: 12px; font-weight: 600; gap: 6px; }
.crit-new-frame-dialog input {
  background: #fff;
  border: 1px solid #d8d5cc;
  border-radius: 6px;
  color: #191918;
  font: 13px/20px ${INTER};
  ${INTER_LOCK};
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
  font: 600 12px/1 ${INTER};
  ${INTER_LOCK};
  height: 34px;
  padding: 0 12px;
}
.crit-new-frame-dialog__actions button[data-primary] { background: #191918; border-color: #191918; color: #fff; }

@media (max-width: 640px) {
  .crit-save-state { bottom: 12px; right: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .crit-frame__mark, .crit-frame__action, .crit-frame__action[data-snapshotting] svg, .crit-frame__title-track, .crit-frame__title-edit-icon, .crit-frame__title-save, .crit-toolbar__title[data-saving] svg, .crit-status-option { animation-duration: .01ms; transition-duration: .01ms; }
}
`
