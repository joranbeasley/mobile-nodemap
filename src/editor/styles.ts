/**
 * Editor stylesheet. Every color is a CSS custom property so a host page can theme it:
 * set --nm-* variables on `.nm-root` or any ancestor.
 */
export const css = /* css */ `
.nm-root {
  --nm-bg: #f3f4f1; --nm-dot: #c9ccc3; --nm-node: #ffffff; --nm-node-2: #f6f7f4;
  --nm-border: #d9dbd3; --nm-text: #1d211c; --nm-muted: #6b7166; --nm-accent: #3b5bdb;
  --nm-wire: #8d9387; --nm-danger: #d63c2f; --nm-ok: #2f9e44; --nm-shadow: 0 1px 2px rgb(20 24 18 / .08), 0 4px 14px rgb(20 24 18 / .08);
  --nm-t-number: #3b5bdb; --nm-t-string: #c2410c; --nm-t-boolean: #9c36b5; --nm-t-list: #0c8599; --nm-t-any: #868e96;
  --nm-font: inherit; --nm-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  position: relative; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; background-color: var(--nm-bg); color: var(--nm-text); font-family: var(--nm-font);
  background-image: radial-gradient(circle, var(--nm-dot) 1px, transparent 1.2px);
  -webkit-tap-highlight-color: transparent; contain: strict;
}
@media (prefers-color-scheme: dark) { .nm-root:not([data-theme="light"]) { --nm-bg: #161814; --nm-dot: #2c3029; --nm-node: #20231e; --nm-node-2: #272a25; --nm-border: #353931; --nm-text: #e8eae4; --nm-muted: #9aa094; --nm-accent: #7c94f5; --nm-wire: #6c7267; --nm-danger: #ff6b5e; --nm-ok: #51cf66; --nm-shadow: 0 1px 2px rgb(0 0 0 / .4), 0 6px 18px rgb(0 0 0 / .35); --nm-t-number: #7c94f5; --nm-t-string: #fb8c3c; --nm-t-boolean: #cc5de8; --nm-t-list: #22b8cf; --nm-t-any: #adb5bd; } }
.nm-root[data-theme="dark"] { --nm-bg: #161814; --nm-dot: #2c3029; --nm-node: #20231e; --nm-node-2: #272a25; --nm-border: #353931; --nm-text: #e8eae4; --nm-muted: #9aa094; --nm-accent: #7c94f5; --nm-wire: #6c7267; --nm-danger: #ff6b5e; --nm-ok: #51cf66; --nm-shadow: 0 1px 2px rgb(0 0 0 / .4), 0 6px 18px rgb(0 0 0 / .35); --nm-t-number: #7c94f5; --nm-t-string: #fb8c3c; --nm-t-boolean: #cc5de8; --nm-t-list: #22b8cf; --nm-t-any: #adb5bd; }

.nm-root [hidden] { display: none !important; }
.nm-viewport { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.nm-wires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.nm-wires path { fill: none; }
.nm-edge { stroke: var(--nm-wire); stroke-width: 2.5; stroke-linecap: round; }
.nm-edge[data-type] { stroke: var(--nm-port-color); }
.nm-edge-hit { stroke: transparent; stroke-width: 22; pointer-events: stroke; cursor: pointer; }
.nm-edge-g.nm-selected .nm-edge { stroke: var(--nm-accent); stroke-width: 4; }
.nm-edge-g.nm-flow .nm-edge { stroke-dasharray: 6 6; animation: nm-flow .6s linear infinite; }
.nm-temp { stroke: var(--nm-accent); stroke-width: 3; stroke-dasharray: 7 6; }
@keyframes nm-flow { to { stroke-dashoffset: -12; } }

.nm-node { position: absolute; left: 0; top: 0; min-width: 176px; max-width: 250px; background: var(--nm-node);
  border: 1px solid var(--nm-border); border-radius: 10px; box-shadow: var(--nm-shadow); font-size: 13px; line-height: 1.3;
  --nm-head: var(--nm-node-accent, var(--nm-muted)); cursor: grab; }
.nm-node.nm-selected { outline: 2.5px solid var(--nm-accent); outline-offset: 2px; }
.nm-node.nm-dragging { cursor: grabbing; box-shadow: var(--nm-shadow), 0 12px 28px rgb(0 0 0 / .18); z-index: 2; }
.nm-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 8px; border-bottom: 1px solid var(--nm-border);
  border-radius: 10px 10px 0 0; background: linear-gradient(color-mix(in srgb, var(--nm-head) 14%, transparent), transparent); }
.nm-title { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nm-cat { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--nm-muted); }
.nm-status { width: 8px; height: 8px; border-radius: 50%; background: var(--nm-head); flex: none; }
.nm-node[data-status="running"] .nm-status { background: var(--nm-accent); animation: nm-pulse .8s ease-in-out infinite alternate; }
.nm-node[data-status="error"] .nm-status { background: var(--nm-danger); }
.nm-node[data-status="error"] { border-color: var(--nm-danger); }
.nm-node[data-status="skipped"] { opacity: .7; }
@keyframes nm-pulse { from { opacity: .3; transform: scale(.7); } }

.nm-body { padding: 6px 0 8px; display: flex; flex-direction: column; gap: 2px; }
.nm-field { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; padding: 3px 12px; color: var(--nm-muted); font-size: 12px; }
.nm-field > span { white-space: nowrap; }
.nm-field .nm-range { display: flex; gap: 6px; align-items: center; min-width: 0; }
.nm-root input, .nm-root select, .nm-root textarea { font: inherit; font-size: 16px; color: var(--nm-text); background: var(--nm-node-2);
  border: 1px solid var(--nm-border); border-radius: 6px; padding: 3px 6px; min-width: 0; width: 100%; box-sizing: border-box; touch-action: manipulation; user-select: text; -webkit-user-select: text; }
.nm-root input[type="number"] { width: 64px; flex: none; font-variant-numeric: tabular-nums; }
.nm-root input[type="range"] { padding: 0; border: 0; background: transparent; accent-color: var(--nm-head); height: 28px; flex: 1; }
.nm-root input[type="checkbox"] { width: 22px; height: 22px; accent-color: var(--nm-head); justify-self: start; }
.nm-root input:focus-visible, .nm-root select:focus-visible, .nm-root textarea:focus-visible, .nm-root button:focus-visible { outline: 2px solid var(--nm-accent); outline-offset: 1px; }
.nm-mono { font-family: var(--nm-mono) !important; font-size: 14px !important; }
@media (pointer: fine) { .nm-root input, .nm-root select, .nm-root textarea { font-size: 12px; } .nm-mono { font-size: 12px !important; } }

.nm-row { position: relative; display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 14px; }
.nm-row.nm-out { justify-content: flex-end; }
.nm-label { color: var(--nm-text); white-space: nowrap; }
.nm-val { color: var(--nm-muted); font-family: var(--nm-mono); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-variant-numeric: tabular-nums; }
.nm-in .nm-val { margin-left: auto; }
.nm-out .nm-val { margin-right: auto; }
.nm-in .nm-inline { margin-left: auto; display: flex; justify-content: flex-end; min-width: 0; }
.nm-in .nm-inline input[type="number"] { width: 72px; }
.nm-in.nm-connected .nm-inline { display: none; }
.nm-in:not(.nm-connected) .nm-val { display: none; }

.nm-port { position: absolute; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%;
  background: var(--nm-node); border: 2.5px solid var(--nm-port-color, var(--nm-t-any)); box-sizing: border-box; cursor: crosshair; z-index: 1; }
.nm-port::before { content: ""; position: absolute; inset: -15px; border-radius: 50%; }
.nm-port[data-dir="in"] { left: -7px; }
.nm-port[data-dir="out"] { right: -7px; }
.nm-port.nm-linked { background: var(--nm-port-color, var(--nm-t-any)); }
[data-type="number"] { --nm-port-color: var(--nm-t-number); }
[data-type="string"] { --nm-port-color: var(--nm-t-string); }
[data-type="boolean"] { --nm-port-color: var(--nm-t-boolean); }
[data-type="list"] { --nm-port-color: var(--nm-t-list); }
.nm-connecting .nm-port { opacity: .25; }
.nm-connecting .nm-port.nm-ok, .nm-connecting .nm-port.nm-anchor { opacity: 1; }
.nm-port.nm-ok { animation: nm-ok 1s ease-in-out infinite alternate; }
.nm-port.nm-ok.nm-hover { transform: scale(1.5); }
.nm-port.nm-anchor { box-shadow: 0 0 0 4px color-mix(in srgb, var(--nm-accent) 35%, transparent); }
@keyframes nm-ok { to { box-shadow: 0 0 0 6px color-mix(in srgb, var(--nm-port-color, var(--nm-accent)) 30%, transparent); } }

.nm-view:empty, .nm-error:empty { display: none; }
.nm-view { margin: 4px 10px 0; padding: 8px 10px; border-radius: 7px; background: var(--nm-node-2); font-family: var(--nm-mono); font-size: 12px;
  overflow-wrap: anywhere; max-height: 180px; overflow: hidden; user-select: text; -webkit-user-select: text; }
.nm-error { margin: 4px 10px 0; padding: 6px 8px; border-radius: 6px; font-size: 12px; color: var(--nm-danger);
  background: color-mix(in srgb, var(--nm-danger) 10%, transparent); overflow-wrap: anywhere; }
.nm-plot { display: block; width: 100%; height: auto; overflow: visible; }
.nm-plot-line { fill: none; stroke: var(--nm-t-list); stroke-width: 2; stroke-linejoin: round; }
.nm-plot-area { fill: color-mix(in srgb, var(--nm-t-list) 14%, transparent); stroke: none; }
.nm-plot-axis { stroke: var(--nm-border); stroke-width: 1; }
.nm-plot-dot { fill: var(--nm-t-list); }
.nm-plot-range { display: flex; justify-content: space-between; color: var(--nm-muted); font-size: 10px; margin-top: 2px; }
.nm-plot-empty { color: var(--nm-muted); font-family: var(--nm-font); }

.nm-hud { position: absolute; left: 50%; transform: translateX(-50%); top: calc(10px + env(safe-area-inset-top, 0px)); background: var(--nm-text); color: var(--nm-bg);
  padding: 8px 8px 8px 14px; border-radius: 999px; font-size: 13px; display: flex; gap: 10px; align-items: center; box-shadow: var(--nm-shadow); white-space: nowrap; z-index: 5; }
.nm-hud button { font: inherit; font-size: 13px; border: 0; border-radius: 999px; padding: 4px 10px; background: var(--nm-bg); color: var(--nm-text); }
.nm-toast { position: absolute; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); background: var(--nm-danger); color: #fff;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; z-index: 6; pointer-events: none; transition: opacity .2s; max-width: calc(100% - 32px); }

.nm-toolbar { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px)); display: flex; gap: 6px; z-index: 4;
  background: var(--nm-node); border: 1px solid var(--nm-border); border-radius: 14px; padding: 5px; box-shadow: var(--nm-shadow); }
.nm-btn { appearance: none; border: 0; background: transparent; color: var(--nm-text); min-width: 44px; height: 44px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-size: 14px; padding: 0 10px; cursor: pointer; }
.nm-btn:hover { background: var(--nm-node-2); }
.nm-btn:disabled { opacity: .35; cursor: default; background: transparent; }
.nm-btn svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.nm-btn.nm-primary { background: var(--nm-accent); color: #fff; }
.nm-btn.nm-danger { color: var(--nm-danger); }
.nm-sep { width: 1px; background: var(--nm-border); margin: 6px 2px; }

.nm-sheet-backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / .25); z-index: 8; }
.nm-sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 72%; display: flex; flex-direction: column; z-index: 9;
  background: var(--nm-node); border-radius: 18px 18px 0 0; box-shadow: 0 -8px 30px rgb(0 0 0 / .2); padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: nm-up .18s ease-out; user-select: none; }
@media (min-width: 720px) { .nm-sheet { left: 50%; right: auto; width: 440px; transform: translateX(-50%); bottom: 16px; border-radius: 16px; animation: none; } }
@keyframes nm-up { from { transform: translateY(30%); opacity: .4; } }
.nm-sheet-grip { width: 40px; height: 4px; border-radius: 2px; background: var(--nm-border); margin: 8px auto 2px; }
.nm-sheet-head { padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 6px; }
.nm-sheet-head strong { font-size: 15px; }
.nm-sheet-head small { color: var(--nm-muted); }
.nm-sheet-list { overflow-y: auto; padding: 0 8px 12px; touch-action: pan-y; overscroll-behavior: contain; }
.nm-sheet-cat { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--nm-muted); padding: 12px 8px 4px; }
.nm-sheet-item { display: flex; width: 100%; align-items: center; gap: 10px; text-align: left; border: 0; background: transparent; color: var(--nm-text);
  font: inherit; font-size: 15px; padding: 10px 8px; min-height: 44px; border-radius: 10px; cursor: pointer; }
.nm-sheet-item:hover, .nm-sheet-item:focus-visible { background: var(--nm-node-2); outline: none; }
.nm-sheet-item i { width: 10px; height: 10px; border-radius: 3px; background: var(--c, var(--nm-muted)); flex: none; }
.nm-sheet-item small { color: var(--nm-muted); font-size: 12px; margin-left: auto; text-align: right; max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (prefers-reduced-motion: reduce) { .nm-root *, .nm-root *::before { animation: none !important; transition: none !important; } }
`;

let injected = false;
export function injectStyles(doc: Document = document): void {
  if (injected || doc.getElementById('nm-styles')) return;
  const style = doc.createElement('style');
  style.id = 'nm-styles';
  style.textContent = css;
  doc.head.appendChild(style);
  injected = true;
}
