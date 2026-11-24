/**
 * Themes and node flavors.
 *
 * A theme is plain data: a palette, a node shape and how flavors look. Every node has a
 * flavor that says what role it plays (source, transform, sink, view, control). Themes give
 * each flavor a colour, and the editor gives each a recognisable silhouette, so a map reads
 * at a glance even zoomed out on a phone.
 */
import type { NodeType, PortDef } from '../core/types.js';

/** Built-in flavors. Packs may use their own names; themes can style those too. */
export type Flavor = 'source' | 'transform' | 'sink' | 'view' | 'control' | (string & {});

export interface ThemeColors {
  bg: string;
  dot: string;
  node: string;
  node2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  wire: string;
  danger: string;
  ok: string;
  /** Port and wire colours per value type. */
  number: string;
  string: string;
  boolean: string;
  list: string;
  any: string;
}

export interface Theme {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  colors: ThemeColors;
  /** Colour for each flavor (node header and markings). */
  flavors: Record<'source' | 'transform' | 'sink' | 'view' | 'control', string> & Record<string, string>;
  /** How node headers use the flavor colour. */
  header?: 'tint' | 'solid' | 'line';
  /** Node corner radius in px. */
  radius?: number;
  shadow?: string;
  font?: string;
  mono?: string;
  /** Use the node type's own `color` over its flavor colour. Default true. */
  nodeColors?: boolean;
}

/** What role a node plays, from its definition: explicit `flavor`, else inferred from its shape. */
export function flavorOf(def: NodeType | undefined, inputs: PortDef[], outputs: PortDef[]): Flavor {
  if (def?.flavor) return def.flavor;
  if (def?.view && !outputs.length) return 'view';
  if (!inputs.length) return 'source';
  if (!outputs.length) return 'sink';
  if (/logic|async|control|flow/i.test(def?.category ?? '')) return 'control';
  return 'transform';
}

const themes = new Map<string, Theme>();

export const defineTheme = (t: Theme): Theme => t;

export function registerTheme(t: Theme): Theme {
  themes.set(t.id, t);
  return t;
}

export const getTheme = (id: string) => themes.get(id);
export const listThemes = () => [...themes.values()];

/** CSS that applies a theme to any `.nm-root[data-nm-theme="<id>"]`. */
export function themeCss(t: Theme): string {
  const c = t.colors;
  const sel = `.nm-root[data-nm-theme="${t.id}"]`;
  const vars: Record<string, string | undefined> = {
    bg: c.bg, dot: c.dot, node: c.node, 'node-2': c.node2, border: c.border, text: c.text, muted: c.muted,
    accent: c.accent, wire: c.wire, danger: c.danger, ok: c.ok,
    't-number': c.number, 't-string': c.string, 't-boolean': c.boolean, 't-list': c.list, 't-any': c.any,
    shadow: t.shadow, font: t.font, mono: t.mono, radius: t.radius !== undefined ? `${t.radius}px` : undefined,
  };
  for (const [f, col] of Object.entries(t.flavors)) vars[`f-${f}`] = col;
  const body = Object.entries(vars)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `--nm-${k}: ${v};`)
    .join(' ');
  const custom = Object.keys(t.flavors)
    .filter((f) => !['source', 'transform', 'sink', 'view', 'control'].includes(f))
    .map((f) => `${sel} .nm-node[data-flavor="${f}"] { --nm-flavor: var(--nm-f-${f}); }`)
    .join('\n');
  return `${sel} { ${body} color-scheme: ${t.mode}; }\n${custom}`;
}

const shadowLight = '0 1px 2px rgb(20 24 18 / .08), 0 4px 14px rgb(20 24 18 / .08)';
const shadowDark = '0 1px 2px rgb(0 0 0 / .45), 0 6px 18px rgb(0 0 0 / .35)';

// ---- light ------------------------------------------------------------------------------

export const daylight = registerTheme({
  id: 'daylight',
  name: 'Daylight',
  mode: 'light',
  header: 'tint',
  radius: 10,
  shadow: shadowLight,
  colors: {
    bg: '#f3f4f1', dot: '#c9ccc3', node: '#ffffff', node2: '#f6f7f4', border: '#d9dbd3', text: '#1d211c', muted: '#6b7166',
    accent: '#3b5bdb', wire: '#8d9387', danger: '#d63c2f', ok: '#2f9e44',
    number: '#3b5bdb', string: '#c2410c', boolean: '#9c36b5', list: '#0c8599', any: '#868e96',
  },
  flavors: { source: '#2b8a3e', transform: '#3b5bdb', sink: '#c2255c', view: '#1971c2', control: '#e67700' },
});

export const paper = registerTheme({
  id: 'paper',
  name: 'Paper',
  mode: 'light',
  header: 'line',
  radius: 3,
  shadow: '0 1px 0 rgb(60 40 20 / .12)',
  font: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  colors: {
    bg: '#f4efe6', dot: '#d9cfbd', node: '#fffdf8', node2: '#f7f1e6', border: '#d8ccb6', text: '#2b2418', muted: '#7a6c55',
    accent: '#9c3d1c', wire: '#a08f72', danger: '#b02a1c', ok: '#4d7c0f',
    number: '#1f5f8b', string: '#9c3d1c', boolean: '#6f4e9c', list: '#2f7a6b', any: '#8a7d68',
  },
  flavors: { source: '#4d7c0f', transform: '#1f5f8b', sink: '#9c3d1c', view: '#6f4e9c', control: '#b7791f' },
  nodeColors: false,
});

export const mint = registerTheme({
  id: 'mint',
  name: 'Mint',
  mode: 'light',
  header: 'solid',
  radius: 14,
  shadow: '0 2px 8px rgb(16 80 70 / .10)',
  colors: {
    bg: '#eaf6f2', dot: '#bfe0d6', node: '#ffffff', node2: '#f0faf7', border: '#c7e4da', text: '#0f2e28', muted: '#4f6f67',
    accent: '#0ca678', wire: '#7fb3a6', danger: '#e03131', ok: '#0ca678',
    number: '#1c7ed6', string: '#e8590c', boolean: '#ae3ec9', list: '#0c8599', any: '#7a8f8a',
  },
  flavors: { source: '#0ca678', transform: '#1c7ed6', sink: '#e8590c', view: '#7048e8', control: '#f59f00' },
  nodeColors: false,
});

// ---- dark -------------------------------------------------------------------------------

export const midnight = registerTheme({
  id: 'midnight',
  name: 'Midnight',
  mode: 'dark',
  header: 'tint',
  radius: 10,
  shadow: shadowDark,
  colors: {
    bg: '#161814', dot: '#2c3029', node: '#20231e', node2: '#272a25', border: '#353931', text: '#e8eae4', muted: '#9aa094',
    accent: '#7c94f5', wire: '#6c7267', danger: '#ff6b5e', ok: '#51cf66',
    number: '#7c94f5', string: '#fb8c3c', boolean: '#cc5de8', list: '#22b8cf', any: '#adb5bd',
  },
  flavors: { source: '#51cf66', transform: '#7c94f5', sink: '#f783ac', view: '#4dabf7', control: '#ffa94d' },
});

export const graphite = registerTheme({
  id: 'graphite',
  name: 'Graphite',
  mode: 'dark',
  header: 'line',
  radius: 4,
  shadow: '0 0 0 1px rgb(0 0 0 / .4)',
  colors: {
    bg: '#1b1d21', dot: '#2a2d33', node: '#24272d', node2: '#2c3037', border: '#3a3f47', text: '#e3e6ea', muted: '#8b929c',
    accent: '#e9ecef', wire: '#5c636e', danger: '#fa5252', ok: '#69db7c',
    number: '#a5d8ff', string: '#ffd8a8', boolean: '#eebefa', list: '#99e9f2', any: '#ced4da',
  },
  flavors: { source: '#69db7c', transform: '#a5d8ff', sink: '#ffa8a8', view: '#d0bfff', control: '#ffe066' },
  nodeColors: false,
});

export const synthwave = registerTheme({
  id: 'synthwave',
  name: 'Synthwave',
  mode: 'dark',
  header: 'solid',
  radius: 12,
  shadow: '0 0 0 1px rgb(255 61 209 / .25), 0 8px 24px rgb(20 0 40 / .6)',
  colors: {
    bg: '#140b26', dot: '#2d1b4e', node: '#1f1238', node2: '#291848', border: '#4a2d7a', text: '#f4ecff', muted: '#a993d6',
    accent: '#ff3dd1', wire: '#7a5cc2', danger: '#ff4d6d', ok: '#3dffb4',
    number: '#3dd9ff', string: '#ffb03d', boolean: '#ff3dd1', list: '#3dffb4', any: '#b9a6e8',
  },
  flavors: { source: '#3dffb4', transform: '#3dd9ff', sink: '#ff3dd1', view: '#b07cff', control: '#ffb03d' },
  nodeColors: false,
});

export const builtinThemes = [daylight, paper, mint, midnight, graphite, synthwave];
