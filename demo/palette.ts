/**
 * A third-party pack, written only against the public API, the way an outside package would.
 * It adds a `color` port type, a colour-picker param kind, five nodes, a view and its CSS,
 * then builds a graph type on top of the built-in math one.
 */
import { definePack, defineNode, defineGraphType, mathGraph, type NodeResult, type ParamKind } from '../src/index.js';

// ---- colour maths ----------------------------------------------------------------------
type RGB = [number, number, number];
const hex = (c: unknown): RGB => {
  const m = /^#?([\da-f]{6})$/i.exec(String(c ?? '').trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
const luminance = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// ---- a param kind: native colour picker plus the hex code -------------------------------
const colorPicker: ParamKind = {
  kind: 'color',
  render({ value, set, key, param }) {
    const wrap = document.createElement('span');
    wrap.className = 'pal-pick';
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.key = key;
    input.setAttribute('aria-label', param.label ?? param.name);
    input.value = toHex(hex(value));
    const code = document.createElement('code');
    code.textContent = input.value;
    input.addEventListener('input', () => {
      code.textContent = input.value;
      set(input.value);
    });
    wrap.append(input, code);
    return wrap;
  },
  update(el, value) {
    const input = el.querySelector('input')!;
    input.value = toHex(hex(value));
    el.querySelector('code')!.textContent = input.value;
  },
};

// ---- views ---------------------------------------------------------------------------------
const swatches = {
  render(el: HTMLElement, r: NodeResult | undefined) {
    const list = ([] as unknown[]).concat(r?.outputs?.colors ?? r?.outputs?.color ?? []);
    el.innerHTML = list.length
      ? `<div class="pal-row">${list.map((c) => `<i style="background:${toHex(hex(c))}" title="${toHex(hex(c))}"></i>`).join('')}</div>`
      : '';
  },
};
const contrastView = {
  render(el: HTMLElement, r: NodeResult | undefined) {
    const ratio = Number(r?.outputs?.ratio ?? 0);
    const fg = String(r?.outputs?.fg ?? '#000');
    const bg = String(r?.outputs?.bg ?? '#fff');
    const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'fails';
    el.innerHTML = `<div class="pal-contrast" style="color:${fg};background:${bg}">Aa <b>${ratio.toFixed(2)}:1</b></div><div class="pal-grade" data-pass="${ratio >= 4.5}">${grade}</div>`;
  },
};

const COLOR = '#d6336c';

export const palettePack = definePack({
  id: 'acme/palette',
  title: 'Palette',
  version: '1.0.0',
  portTypes: [
    // Colours are hex strings, so text can flow in; it is normalised on the way.
    { id: 'color', label: 'Colour', color: COLOR, accepts: ['string'], coerce: (v) => toHex(hex(v)), inline: 'color', default: '#888888' },
  ],
  paramKinds: [colorPicker],
  nodes: [
    defineNode({
      type: 'palette/color',
      title: 'Colour',
      category: 'Colour',
      color: COLOR,
      params: [{ name: 'value', label: 'pick', kind: 'color', default: '#3b5bdb' }],
      outputs: { color: 'color' },
      run: (_, { params }) => ({ color: toHex(hex(params.value)) }),
      view: swatches,
    }),
    defineNode({
      type: 'palette/mix',
      title: 'Mix',
      category: 'Colour',
      color: COLOR,
      inputs: { a: 'color', b: 'color', t: { type: 'number', default: 0.5 } },
      outputs: { color: 'color' },
      run: ({ a, b, t }) => ({ color: toHex(mix(hex(a), hex(b), Number(t))) }),
      view: swatches,
    }),
    defineNode({
      type: 'palette/scale',
      title: 'Tint scale',
      category: 'Colour',
      color: COLOR,
      description: 'Light-to-dark steps of one colour',
      tags: ['shades', 'ramp'],
      inputs: { base: 'color', steps: { type: 'number', default: 7 } },
      outputs: { colors: 'list' },
      run: ({ base, steps }) => {
        const n = Math.max(2, Math.min(12, Math.round(Number(steps))));
        const c = hex(base);
        return {
          colors: Array.from({ length: n }, (_, i) => {
            const t = i / (n - 1);
            return toHex(t < 0.5 ? mix([255, 255, 255], c, t * 2) : mix(c, [0, 0, 0], (t - 0.5) * 1.6));
          }),
        };
      },
      view: swatches,
    }),
    defineNode({
      type: 'palette/swatches',
      title: 'Swatches',
      category: 'Colour',
      color: COLOR,
      description: 'Shows every colour wired in',
      inputs: { colors: { type: 'any', multiple: true } },
      outputs: { colors: 'list' },
      run: ({ colors }) => ({ colors: colors.flat().map((c: unknown) => toHex(hex(c))) }),
      view: swatches,
    }),
    defineNode({
      type: 'palette/contrast',
      title: 'Contrast check',
      category: 'Colour',
      color: COLOR,
      description: 'WCAG contrast ratio between text and background',
      tags: ['accessibility', 'a11y', 'wcag'],
      inputs: { fg: 'color', bg: 'color' },
      outputs: { ratio: 'number', fg: 'color', bg: 'color' },
      run: ({ fg, bg }) => ({ ratio: contrast(hex(fg), hex(bg)), fg: toHex(hex(fg)), bg: toHex(hex(bg)) }),
      view: contrastView,
    }),
  ],
  css: `
.pal-pick { display: inline-flex; align-items: center; gap: 6px; }
.pal-pick input[type="color"] { width: 34px; height: 28px; padding: 2px; border-radius: 6px; }
.pal-pick code { font-family: var(--_mono); font-size: 12px; color: var(--_muted); }
.pal-row { display: flex; gap: 3px; }
.pal-row i { flex: 1; height: 26px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
.pal-contrast { font-family: var(--_font); font-size: 15px; padding: 8px 10px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
.pal-contrast b { font-size: 12px; font-weight: 600; margin-left: 6px; }
.pal-grade { margin-top: 6px; font-family: var(--_font); font-weight: 600; font-size: 12px; color: var(--_danger); }
.pal-grade[data-pass="true"] { color: var(--_ok); }
`,
});

const N = (id: string, type: string, x: number, y: number, params: Record<string, unknown> = {}) => ({ id, type, x, y, params });
const E = (a: string, ap: string, b: string, bp: string) => ({ id: `${a}-${b}-${bp}`, from: { node: a, port: ap }, to: { node: b, port: bp } });

/** A graph type made from the math graph type plus this pack, keeping only what a palette needs. */
export const paletteGraph = defineGraphType({
  id: 'acme/palette',
  title: 'Palette',
  description: 'A third-party graph type: colour nodes from a pack, plus numbers from the math graph type.',
  icon: '◐',
  extends: [mathGraph],
  packs: [palettePack],
  exclude: ['async/*', 'list/*', 'text/*', 'logic/*', 'graph/*', 'view/plot*', 'math/expression', 'math/fn'],
  editor: { wires: 'smart', autoLayout: true },
  examples: [
    {
      id: 'brand',
      name: 'Brand palette',
      description: 'Pick a brand colour; tints, a mix and an accessibility check follow.',
      graph: {
        version: 1,
        type: 'acme/palette',
        nodes: [
          N('brand', 'palette/color', 0, 0, { value: '#3b5bdb' }),
          N('accent', 'palette/color', 0, 0, { value: '#f08c00' }),
          N('scale', 'palette/scale', 0, 0, { steps: 7 }),
          N('mix', 'palette/mix', 0, 0, { t: 0.5 }),
          N('all', 'palette/swatches', 0, 0),
          N('ink', 'palette/color', 0, 0, { value: '#ffffff' }),
          N('check', 'palette/contrast', 0, 0),
        ],
        edges: [
          E('brand', 'color', 'scale', 'base'),
          E('brand', 'color', 'mix', 'a'),
          E('accent', 'color', 'mix', 'b'),
          E('brand', 'color', 'all', 'colors'),
          E('mix', 'color', 'all', 'colors'),
          E('accent', 'color', 'all', 'colors'),
          E('ink', 'color', 'check', 'fg'),
          E('brand', 'color', 'check', 'bg'),
        ],
      },
    },
  ],
});
