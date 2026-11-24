/**
 * Editor stylesheet. Every color is a CSS custom property so a host page can theme it:
 * set --nm-* variables on `.nm-root` or any ancestor (they also reach into <node-map>'s shadow root).
 */
export const css = /* css */ `
.nm-root {
  --_bg: var(--nm-bg, #f3f4f1); --_dot: var(--nm-dot, #c9ccc3); --_node: var(--nm-node, #ffffff); --_node-2: var(--nm-node-2, #f6f7f4);
  --_border: var(--nm-border, #d9dbd3); --_text: var(--nm-text, #1d211c); --_muted: var(--nm-muted, #6b7166); --_accent: var(--nm-accent, #3b5bdb);
  --_wire: var(--nm-wire, #8d9387); --_danger: var(--nm-danger, #d63c2f); --_ok: var(--nm-ok, #2f9e44); --_shadow: var(--nm-shadow, 0 1px 2px rgb(20 24 18 / .08), 0 4px 14px rgb(20 24 18 / .08));
  --_t-number: var(--nm-t-number, #3b5bdb); --_t-string: var(--nm-t-string, #c2410c); --_t-boolean: var(--nm-t-boolean, #9c36b5); --_t-list: var(--nm-t-list, #0c8599); --_t-any: var(--nm-t-any, #868e96);
  --_font: var(--nm-font, inherit); --_radius: var(--nm-radius, 10px);
  --_f-source: var(--nm-f-source, #2b8a3e); --_f-transform: var(--nm-f-transform, #3b5bdb); --_f-sink: var(--nm-f-sink, #c2255c); --_f-view: var(--nm-f-view, #1971c2); --_f-control: var(--nm-f-control, #e67700); --_mono: var(--nm-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  position: relative; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; background-color: var(--_bg); color: var(--_text); font-family: var(--_font);
  background-image: radial-gradient(circle, var(--_dot) 1px, transparent 1.2px);
  -webkit-tap-highlight-color: transparent; contain: strict;
}
@media (prefers-color-scheme: dark) { .nm-root:not([data-theme="light"]) { --_bg: var(--nm-bg, #161814); --_dot: var(--nm-dot, #2c3029); --_node: var(--nm-node, #20231e); --_node-2: var(--nm-node-2, #272a25); --_border: var(--nm-border, #353931); --_text: var(--nm-text, #e8eae4); --_muted: var(--nm-muted, #9aa094); --_accent: var(--nm-accent, #7c94f5); --_wire: var(--nm-wire, #6c7267); --_danger: var(--nm-danger, #ff6b5e); --_ok: var(--nm-ok, #51cf66); --_shadow: var(--nm-shadow, 0 1px 2px rgb(0 0 0 / .4), 0 6px 18px rgb(0 0 0 / .35)); --_t-number: var(--nm-t-number, #7c94f5); --_t-string: var(--nm-t-string, #fb8c3c); --_t-boolean: var(--nm-t-boolean, #cc5de8); --_t-list: var(--nm-t-list, #22b8cf); --_t-any: var(--nm-t-any, #adb5bd); } }
.nm-root[data-theme="dark"] { --_bg: var(--nm-bg, #161814); --_dot: var(--nm-dot, #2c3029); --_node: var(--nm-node, #20231e); --_node-2: var(--nm-node-2, #272a25); --_border: var(--nm-border, #353931); --_text: var(--nm-text, #e8eae4); --_muted: var(--nm-muted, #9aa094); --_accent: var(--nm-accent, #7c94f5); --_wire: var(--nm-wire, #6c7267); --_danger: var(--nm-danger, #ff6b5e); --_ok: var(--nm-ok, #51cf66); --_shadow: var(--nm-shadow, 0 1px 2px rgb(0 0 0 / .4), 0 6px 18px rgb(0 0 0 / .35)); --_t-number: var(--nm-t-number, #7c94f5); --_t-string: var(--nm-t-string, #fb8c3c); --_t-boolean: var(--nm-t-boolean, #cc5de8); --_t-list: var(--nm-t-list, #22b8cf); --_t-any: var(--nm-t-any, #adb5bd); }

.nm-root [hidden] { display: none !important; }
.nm-viewport { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.nm-wires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.nm-wires path { fill: none; }
.nm-edge { stroke: var(--_wire); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.nm-edge[data-type] { stroke: var(--nm-port-color, var(--_wire)); }
.nm-edge-hit { stroke: transparent; stroke-width: 22; pointer-events: stroke; cursor: pointer; }
.nm-edge-g.nm-selected .nm-edge { stroke: var(--_accent); stroke-width: 4; }
.nm-edge-g.nm-flow .nm-edge { stroke-dasharray: 6 6; animation: nm-flow .6s linear infinite; }
.nm-temp { stroke: var(--_accent); stroke-width: 3; stroke-dasharray: 7 6; }
@keyframes nm-flow { to { stroke-dashoffset: -12; } }

.nm-node { position: absolute; left: 0; top: 0; min-width: 176px; max-width: 250px; background: var(--_node);
  border: 1px solid var(--_border); border-radius: var(--_radius); box-shadow: var(--_shadow); font-size: 13px; line-height: 1.3;
  --nm-head: var(--nm-type-color, var(--nm-flavor, var(--_muted))); cursor: grab; }
.nm-node.nm-selected { outline: 2.5px solid var(--_accent); outline-offset: 2px; }
.nm-node.nm-dragging { cursor: grabbing; box-shadow: var(--_shadow), 0 12px 28px rgb(0 0 0 / .18); z-index: 2; }
.nm-head { display: flex; align-items: center; gap: 8px; padding: 9px 10px 8px; border-bottom: 1px solid var(--_border);
  border-radius: var(--_radius) var(--_radius) 0 0; background: linear-gradient(color-mix(in srgb, var(--nm-head) 14%, transparent), transparent); }

/* Flavors: a colour from the theme and a silhouette from the role. */
.nm-node[data-flavor="source"] { --nm-flavor: var(--_f-source); border-left: 4px solid var(--nm-head); border-top-left-radius: calc(var(--_radius) * 2.4); border-bottom-left-radius: calc(var(--_radius) * 2.4); }
.nm-node[data-flavor="transform"] { --nm-flavor: var(--_f-transform); }
.nm-node[data-flavor="sink"] { --nm-flavor: var(--_f-sink); border-right: 4px solid var(--nm-head); border-top-right-radius: calc(var(--_radius) * 2.4); border-bottom-right-radius: calc(var(--_radius) * 2.4); }
.nm-node[data-flavor="view"] { --nm-flavor: var(--_f-view); border-color: color-mix(in srgb, var(--nm-head) 45%, var(--_border)); box-shadow: var(--_shadow), 0 0 0 3px color-mix(in srgb, var(--nm-head) 12%, transparent); }
.nm-node[data-flavor="control"] { --nm-flavor: var(--_f-control); border-style: dashed; border-color: color-mix(in srgb, var(--nm-head) 55%, var(--_border)); }
.nm-node[data-flavor="source"] .nm-head { border-top-left-radius: calc(var(--_radius) * 2.4); }
.nm-node[data-flavor="sink"] .nm-head { border-top-right-radius: calc(var(--_radius) * 2.4); }
.nm-root[data-node-colors="off"] .nm-node { --nm-head: var(--nm-flavor, var(--_muted)); }
/* Header styles a theme can pick. */
.nm-root[data-nm-header="solid"] .nm-head { background: var(--nm-head); border-bottom-color: transparent; }
.nm-root[data-nm-header="solid"] .nm-head .nm-title, .nm-root[data-nm-header="solid"] .nm-head .nm-icon { color: var(--_node); }
.nm-root[data-nm-header="solid"] .nm-head .nm-cat { color: color-mix(in srgb, var(--_node) 75%, transparent); }
.nm-root[data-nm-header="solid"] .nm-head .nm-status { background: var(--_node); }
.nm-root[data-nm-header="line"] .nm-head { background: none; box-shadow: inset 0 3px 0 var(--nm-head); }
.nm-more { padding: 0 12px; }
.nm-more summary { cursor: pointer; color: var(--_muted); font-size: 12px; padding: 4px 0; list-style: none; display: flex; align-items: center; gap: 4px; min-height: 28px; }
.nm-more summary::-webkit-details-marker { display: none; }
.nm-more summary::before { content: "▸"; font-size: 10px; transition: transform .15s; }
.nm-more[open] summary::before { transform: rotate(90deg); }
.nm-more .nm-field { padding-inline: 0; }
.nm-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; font-size: 14px; line-height: 1; color: var(--nm-head); }
.nm-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.nm-head .nm-icon + .nm-title { margin-left: -2px; }
.nm-port-multi { border-radius: 4px; }
.nm-sheet-item .nm-icon { width: 20px; color: var(--c); }
.nm-title { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nm-cat { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--_muted); }
.nm-status { width: 8px; height: 8px; border-radius: 50%; background: var(--nm-head); flex: none; }
.nm-node[data-status="running"] .nm-status { background: var(--_accent); animation: nm-pulse .8s ease-in-out infinite alternate; }
.nm-node[data-status="error"] .nm-status { background: var(--_danger); }
.nm-node[data-status="error"] { border-color: var(--_danger); }
.nm-node[data-status="skipped"] { opacity: .7; }
@keyframes nm-pulse { from { opacity: .3; transform: scale(.7); } }

.nm-body { padding: 6px 0 8px; display: flex; flex-direction: column; gap: 2px; }
.nm-field { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; padding: 3px 12px; color: var(--_muted); font-size: 12px; }
.nm-field > span { white-space: nowrap; }
.nm-field .nm-range { display: flex; gap: 6px; align-items: center; min-width: 0; }
.nm-root input, .nm-root select, .nm-root textarea { font: inherit; font-size: 16px; color: var(--_text); background: var(--_node-2);
  border: 1px solid var(--_border); border-radius: 6px; padding: 3px 6px; min-width: 0; width: 100%; box-sizing: border-box; touch-action: manipulation; user-select: text; -webkit-user-select: text; }
.nm-root input[type="number"] { width: 64px; flex: none; font-variant-numeric: tabular-nums; }
.nm-root input[type="range"] { padding: 0; border: 0; background: transparent; accent-color: var(--nm-head); height: 28px; flex: 1; }
.nm-root input[type="checkbox"] { width: 22px; height: 22px; accent-color: var(--nm-head); justify-self: start; }
.nm-root input:focus-visible, .nm-root select:focus-visible, .nm-root textarea:focus-visible, .nm-root button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
.nm-mono { font-family: var(--_mono) !important; font-size: 14px !important; }
@media (pointer: fine) { .nm-root input, .nm-root select, .nm-root textarea { font-size: 12px; } .nm-mono { font-size: 12px !important; } }

.nm-row { position: relative; display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 14px; }
.nm-row.nm-out { justify-content: flex-end; }
.nm-label { color: var(--_text); white-space: nowrap; }
.nm-val { color: var(--_muted); font-family: var(--_mono); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-variant-numeric: tabular-nums; }
.nm-in .nm-val { margin-left: auto; }
.nm-out .nm-val { margin-right: auto; }
.nm-in .nm-inline { margin-left: auto; display: flex; justify-content: flex-end; min-width: 0; }
.nm-in .nm-inline input[type="number"] { width: 72px; }
.nm-in.nm-connected .nm-inline { display: none; }
.nm-in:not(.nm-connected) .nm-val { display: none; }

.nm-port { position: absolute; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%;
  background: var(--_node); border: 2.5px solid var(--nm-port-color, var(--_t-any)); box-sizing: border-box; cursor: crosshair; z-index: 1; }
.nm-port::before { content: ""; position: absolute; inset: -15px; border-radius: 50%; }
.nm-port[data-dir="in"] { left: -7px; }
.nm-port[data-dir="out"] { right: -7px; }
.nm-port.nm-linked { background: var(--nm-port-color, var(--_t-any)); }
[data-type="number"] { --nm-port-color: var(--_t-number); }
[data-type="string"] { --nm-port-color: var(--_t-string); }
[data-type="boolean"] { --nm-port-color: var(--_t-boolean); }
[data-type="list"] { --nm-port-color: var(--_t-list); }
.nm-connecting .nm-port { opacity: .25; }
.nm-connecting .nm-port.nm-ok, .nm-connecting .nm-port.nm-anchor { opacity: 1; }
.nm-port.nm-ok { animation: nm-ok 1s ease-in-out infinite alternate; }
.nm-port.nm-ok.nm-hover { transform: scale(1.5); }
.nm-port.nm-anchor { box-shadow: 0 0 0 4px color-mix(in srgb, var(--_accent) 35%, transparent); }
@keyframes nm-ok { to { box-shadow: 0 0 0 6px color-mix(in srgb, var(--nm-port-color, var(--_accent)) 30%, transparent); } }

.nm-view:empty, .nm-error:empty { display: none; }
.nm-view { margin: 4px 10px 0; padding: 8px 10px; border-radius: 7px; background: var(--_node-2); font-family: var(--_mono); font-size: 12px;
  overflow-wrap: anywhere; max-height: 180px; overflow: hidden; user-select: text; -webkit-user-select: text; }
.nm-error { margin: 4px 10px 0; padding: 6px 8px; border-radius: 6px; font-size: 12px; color: var(--_danger);
  background: color-mix(in srgb, var(--_danger) 10%, transparent); overflow-wrap: anywhere; }
.nm-plot { display: block; width: 100%; height: auto; overflow: visible; }
.nm-plot-line { fill: none; stroke: var(--_t-list); stroke-width: 2; stroke-linejoin: round; }
.nm-plot-area { fill: color-mix(in srgb, var(--_t-list) 14%, transparent); stroke: none; }
.nm-plot-axis { stroke: var(--_border); stroke-width: 1; }
.nm-plot-dot { fill: var(--_t-list); }
.nm-plot-range { display: flex; justify-content: space-between; color: var(--_muted); font-size: 10px; margin-top: 2px; }
.nm-plot-empty { color: var(--_muted); font-family: var(--_font); }

.nm-hud { position: absolute; left: 50%; transform: translateX(-50%); top: calc(10px + env(safe-area-inset-top, 0px)); background: var(--_text); color: var(--_bg);
  padding: 8px 8px 8px 14px; border-radius: 999px; font-size: 13px; display: flex; gap: 10px; align-items: center; box-shadow: var(--_shadow); white-space: nowrap; z-index: 5; }
.nm-hud button { font: inherit; font-size: 13px; border: 0; border-radius: 999px; padding: 4px 10px; background: var(--_bg); color: var(--_text); }
.nm-toast { position: absolute; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); background: var(--_danger); color: #fff;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; z-index: 6; pointer-events: none; transition: opacity .2s; max-width: calc(100% - 32px); }

.nm-toolbar { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px)); display: flex; gap: 6px; z-index: 4;
  background: var(--_node); border: 1px solid var(--_border); border-radius: 14px; padding: 5px; box-shadow: var(--_shadow); }
.nm-btn { appearance: none; border: 0; background: transparent; color: var(--_text); min-width: 44px; height: 44px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-size: 14px; padding: 0 10px; cursor: pointer; }
.nm-btn:hover { background: var(--_node-2); }
.nm-btn:disabled { opacity: .35; cursor: default; background: transparent; }
.nm-btn svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.nm-btn.nm-primary { background: var(--_accent); color: var(--_bg); }
.nm-btn.nm-danger { color: var(--_danger); }
.nm-sep { width: 1px; background: var(--_border); margin: 6px 2px; }

.nm-sheet-backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / .25); z-index: 8; }
.nm-sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 72%; display: flex; flex-direction: column; z-index: 9;
  background: var(--_node); border-radius: 18px 18px 0 0; box-shadow: 0 -8px 30px rgb(0 0 0 / .2); padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: nm-up .18s ease-out; user-select: none; }
@media (min-width: 720px) { .nm-sheet { left: 50%; right: auto; width: 440px; transform: translateX(-50%); bottom: 16px; border-radius: 16px; animation: none; } }
@keyframes nm-up { from { transform: translateY(30%); opacity: .4; } }
.nm-sheet-grip { width: 40px; height: 4px; border-radius: 2px; background: var(--_border); margin: 8px auto 2px; }
.nm-sheet-head { padding: 6px 14px 10px; display: flex; flex-direction: column; gap: 6px; }
.nm-sheet-head strong { font-size: 15px; }
.nm-sheet-head small { color: var(--_muted); }
.nm-seg { display: flex; gap: 3px; padding: 3px; border-radius: 11px; background: var(--_node-2); border: 1px solid var(--_border); }
.nm-seg button { flex: 1 1 0; min-width: 0; min-height: 38px; border: 0; border-radius: 8px; background: transparent; color: var(--_muted);
  font: inherit; font-size: 14px; font-weight: 500; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.nm-seg button[aria-checked="true"] { background: var(--_node); color: var(--_text); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
.nm-seg button:disabled { opacity: .35; cursor: default; }
.nm-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.nm-chips > span { color: var(--_muted); font-size: 12px; margin-right: 2px; }
.nm-chips button { min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1.5px solid var(--nm-port-color, var(--_t-any)); background: transparent;
  color: var(--_text); font: inherit; font-size: 13px; cursor: pointer; }
.nm-chips button[aria-checked="true"] { background: var(--nm-port-color, var(--_t-any)); color: var(--_node); }
.nm-seg button:focus-visible, .nm-chips button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
.nm-sheet-list { overflow-y: auto; padding: 0 8px 12px; touch-action: pan-y; overscroll-behavior: contain; }
.nm-sheet-cat { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--_muted); padding: 12px 8px 4px; }
.nm-sheet-item { display: flex; width: 100%; align-items: center; gap: 10px; text-align: left; border: 0; background: transparent; color: var(--_text);
  font: inherit; font-size: 15px; padding: 10px 8px; min-height: 44px; border-radius: 10px; cursor: pointer; }
.nm-sheet-item:hover, .nm-sheet-item:focus-visible { background: var(--_node-2); outline: none; }
.nm-sheet-item i { width: 10px; height: 10px; border-radius: 3px; background: var(--c, var(--_muted)); flex: none; }
.nm-sheet-item small { color: var(--_muted); font-size: 12px; margin-left: auto; text-align: right; max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (prefers-reduced-motion: reduce) { .nm-root *, .nm-root *::before { animation: none !important; transition: none !important; } }
`;

/** Add the stylesheet once per document or shadow root. */
export function injectStyles(root: Document | ShadowRoot = document): void {
  const isDoc = (root as Document).nodeType === 9;
  if ((isDoc ? (root as Document).getElementById('nm-styles') : root.querySelector('#nm-styles'))) return;
  const doc = isDoc ? (root as Document) : root.ownerDocument!;
  const style = doc.createElement('style');
  style.id = 'nm-styles';
  style.textContent = css;
  (isDoc ? (root as Document).head : root).appendChild(style);
}

/** Add a pack's stylesheet once per document or shadow root. */
export function injectPackStyles(root: Document | ShadowRoot, id: string, cssText: string): void {
  const isDoc = (root as Document).nodeType === 9;
  const elId = `nm-pack-${id.replace(/[^\w-]/g, '_')}`;
  if (isDoc ? (root as Document).getElementById(elId) : root.querySelector(`#${elId}`)) return;
  const doc = isDoc ? (root as Document) : root.ownerDocument!;
  const style = doc.createElement('style');
  style.id = elId;
  style.textContent = cssText;
  (isDoc ? (root as Document).head : root).appendChild(style);
}
