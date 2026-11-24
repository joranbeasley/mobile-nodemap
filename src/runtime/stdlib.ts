import type { NodeType, NodeResult } from '../core/types.js';
import { INPUT_NODE, OUTPUT_NODE } from './evaluator.js';

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};

const binary = (type: string, title: string, op: (a: number, b: number) => number, b = 0): NodeType => ({
  type,
  title,
  category: 'Math',
  inputs: [
    { name: 'a', type: 'number', default: 0 },
    { name: 'b', type: 'number', default: b },
  ],
  outputs: [{ name: 'out', type: 'number' }],
  run: ({ a, b }) => ({ out: op(num(a), num(b)) }),
});

const IDENT = /^[A-Za-z_$][\w$]*$/;
const exprCache = new Map<string, Function>();

/** Compile a JS expression into a function of the given variable names. Runs unsandboxed: only use trusted input. */
export function compileExpression(vars: string[], expr: string): (...args: unknown[]) => unknown {
  const key = vars.join(',') + '\u0000' + expr;
  let f = exprCache.get(key);
  if (!f) {
    const mathNames = Object.getOwnPropertyNames(Math).filter((n) => !vars.includes(n));
    // eslint-disable-next-line no-new-func
    f = new Function(...vars, `const {${mathNames.join(',')}} = Math;\nreturn (${expr || 'undefined'});`);
    exprCache.set(key, f);
  }
  return f as (...args: unknown[]) => unknown;
}

const parseVars = (s: unknown) =>
  String(s ?? '')
    .split(/[\s,]+/)
    .filter((v) => IDENT.test(v));

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('Cancelled'));
    });
  });

export const formatValue = (v: unknown, max = 60): string => {
  let s: string;
  if (typeof v === 'number') s = Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 3 : 2);
  else if (typeof v === 'string') s = JSON.stringify(v);
  else if (Array.isArray(v)) s = `[${v.slice(0, 6).map((x) => formatValue(x, 12)).join(', ')}${v.length > 6 ? `, …${v.length}` : ''}]`;
  else if (v === undefined) s = '—';
  else s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

const textView = {
  render(el: HTMLElement, r: NodeResult | undefined) {
    el.textContent = r?.status === 'ok' ? formatValue(r.outputs?.value, 140) : r?.error ?? '…';
  },
};

const plotView = {
  render(el: HTMLElement, r: NodeResult | undefined) {
    const raw = r?.outputs?.value;
    const data = Array.isArray(raw) ? raw.map((v) => num(v, NaN)).filter(Number.isFinite) : [];
    const w = 220;
    const h = 96;
    if (data.length < 2) {
      el.innerHTML = `<div class="nm-plot-empty">Connect a list of numbers</div>`;
      return;
    }
    let min = Math.min(...data);
    let max = Math.max(...data);
    if (min === max) (min -= 1), (max += 1);
    const x = (i: number) => 4 + (i / (data.length - 1)) * (w - 8);
    const y = (v: number) => h - 6 - ((v - min) / (max - min)) * (h - 12);
    const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const zero = min < 0 && max > 0 ? `<line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" class="nm-plot-axis"/>` : '';
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" class="nm-plot" role="img" aria-label="Line chart of ${data.length} values">
      ${zero}<polygon points="${x(0)},${h - 6} ${pts} ${x(data.length - 1)},${h - 6}" class="nm-plot-area"/>
      <polyline points="${pts}" class="nm-plot-line"/>
      <circle cx="${x(data.length - 1)}" cy="${y(data[data.length - 1])}" r="3" class="nm-plot-dot"/></svg>
      <div class="nm-plot-range"><span>${formatValue(min)}</span><span>${formatValue(max)}</span></div>`;
  },
};

export const stdlib: NodeType[] = [
  // Graph interface
  {
    type: INPUT_NODE,
    title: 'Graph input',
    category: 'Graph',
    color: '#0e9f6e',
    description: 'A named argument of this node map. Falls back to its value param.',
    params: [
      { name: 'name', kind: 'text', default: 'x' },
      { name: 'type', kind: 'select', default: 'number', options: ['number', 'string', 'boolean', 'list', 'any'] },
      { name: 'value', kind: 'number', default: 0 },
    ],
    ports: (p) => ({ outputs: [{ name: 'value', type: String(p.type ?? 'any') }] }),
    run: (_, { params, graphInputs }) => {
      const name = String(params.name);
      return { value: name in graphInputs ? graphInputs[name] : params.value };
    },
  },
  {
    type: OUTPUT_NODE,
    title: 'Graph output',
    category: 'Graph',
    color: '#0e9f6e',
    description: 'A named result of this node map.',
    params: [{ name: 'name', kind: 'text', default: 'result' }],
    inputs: [{ name: 'value', type: 'any', inline: false }],
    run: ({ value }) => ({ value }),
    view: textView,
  },

  // Values
  {
    type: 'value/number',
    title: 'Number',
    category: 'Values',
    params: [{ name: 'value', kind: 'number', default: 1, min: -10, max: 10, step: 0.1 }],
    outputs: [{ name: 'value', type: 'number' }],
    run: (_, { params }) => ({ value: num(params.value) }),
  },
  {
    type: 'value/text',
    title: 'Text',
    category: 'Values',
    params: [{ name: 'value', kind: 'text', default: 'hello' }],
    outputs: [{ name: 'value', type: 'string' }],
    run: (_, { params }) => ({ value: String(params.value ?? '') }),
  },
  {
    type: 'value/toggle',
    title: 'Toggle',
    category: 'Values',
    params: [{ name: 'value', kind: 'boolean', default: true }],
    outputs: [{ name: 'value', type: 'boolean' }],
    run: (_, { params }) => ({ value: !!params.value }),
  },
  {
    type: 'value/random',
    title: 'Random',
    category: 'Values',
    pure: false,
    inputs: [
      { name: 'min', type: 'number', default: 0 },
      { name: 'max', type: 'number', default: 1 },
    ],
    outputs: [{ name: 'value', type: 'number' }],
    run: ({ min, max }) => ({ value: num(min) + Math.random() * (num(max, 1) - num(min)) }),
  },

  // Math
  binary('math/add', 'Add', (a, b) => a + b),
  binary('math/subtract', 'Subtract', (a, b) => a - b),
  binary('math/multiply', 'Multiply', (a, b) => a * b, 1),
  binary('math/divide', 'Divide', (a, b) => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  }, 1),
  binary('math/power', 'Power', (a, b) => a ** b, 2),
  {
    type: 'math/fn',
    title: 'Function',
    category: 'Math',
    params: [{ name: 'fn', kind: 'select', default: 'sin', options: ['sin', 'cos', 'tan', 'abs', 'sqrt', 'log', 'exp', 'round', 'floor', 'ceil', 'sign'] }],
    inputs: [{ name: 'x', type: 'number', default: 0 }],
    outputs: [{ name: 'out', type: 'number' }],
    run: ({ x }, { params }) => ({ out: (Math as any)[String(params.fn)](num(x)) }),
  },
  {
    type: 'math/clamp',
    title: 'Clamp',
    category: 'Math',
    inputs: [
      { name: 'x', type: 'number', default: 0 },
      { name: 'min', type: 'number', default: 0 },
      { name: 'max', type: 'number', default: 1 },
    ],
    outputs: [{ name: 'out', type: 'number' }],
    run: ({ x, min, max }) => ({ out: Math.min(num(max), Math.max(num(min), num(x))) }),
  },
  {
    type: 'math/expression',
    title: 'Expression',
    category: 'Math',
    color: '#c2410c',
    description: 'A JavaScript expression. Each variable listed becomes an input. Math functions (sin, PI, …) are in scope.',
    params: [
      { name: 'vars', label: 'inputs', kind: 'text', default: 'a, b' },
      { name: 'expr', label: 'expression', kind: 'text', default: 'a * b + 1' },
    ],
    ports: (p) => ({
      inputs: parseVars(p.vars).map((name) => ({ name, type: 'any', default: 0 })),
      outputs: [{ name: 'out', type: 'any' }],
    }),
    run: (inputs, { params }) => {
      const vars = parseVars(params.vars);
      return { out: compileExpression(vars, String(params.expr))(...vars.map((v) => inputs[v])) };
    },
  },

  // Logic
  {
    type: 'logic/compare',
    title: 'Compare',
    category: 'Logic',
    params: [{ name: 'op', kind: 'select', default: '>', options: ['>', '>=', '<', '<=', '==', '!='] }],
    inputs: [
      { name: 'a', type: 'number', default: 0 },
      { name: 'b', type: 'number', default: 0 },
    ],
    outputs: [{ name: 'out', type: 'boolean' }],
    run: ({ a, b }, { params }) => {
      const x = num(a);
      const y = num(b);
      const r = { '>': x > y, '>=': x >= y, '<': x < y, '<=': x <= y, '==': x === y, '!=': x !== y }[String(params.op)];
      return { out: !!r };
    },
  },
  {
    type: 'logic/if',
    title: 'If',
    category: 'Logic',
    inputs: [
      { name: 'cond', type: 'boolean', default: true },
      { name: 'then', type: 'any', default: 1 },
      { name: 'else', type: 'any', default: 0 },
    ],
    outputs: [{ name: 'out', type: 'any' }],
    run: (i) => ({ out: i.cond ? i.then : i.else }),
  },
  {
    type: 'logic/not',
    title: 'Not',
    category: 'Logic',
    inputs: [{ name: 'in', type: 'boolean', default: false }],
    outputs: [{ name: 'out', type: 'boolean' }],
    run: (i) => ({ out: !i.in }),
  },

  // Text
  {
    type: 'text/template',
    title: 'Template',
    category: 'Text',
    description: 'Replaces {a} and {b} with the inputs.',
    params: [{ name: 'template', kind: 'text', default: '{a} and {b}' }],
    inputs: [
      { name: 'a', type: 'any', default: '' },
      { name: 'b', type: 'any', default: '' },
    ],
    outputs: [{ name: 'out', type: 'string' }],
    run: (i, { params }) => ({
      out: String(params.template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in i ? formatValue(i[k], 1e6).replace(/^"|"$/g, '') : m)),
    }),
  },
  {
    type: 'text/case',
    title: 'Change case',
    category: 'Text',
    params: [{ name: 'mode', kind: 'select', default: 'upper', options: ['upper', 'lower', 'title', 'reverse'] }],
    inputs: [{ name: 'text', type: 'string', default: '' }],
    outputs: [{ name: 'out', type: 'string' }],
    run: ({ text }, { params }) => {
      const s = String(text ?? '');
      const m = params.mode;
      return {
        out:
          m === 'upper' ? s.toUpperCase()
          : m === 'lower' ? s.toLowerCase()
          : m === 'reverse' ? [...s].reverse().join('')
          : s.replace(/\b\w/g, (c) => c.toUpperCase()),
      };
    },
  },
  {
    type: 'text/length',
    title: 'Length',
    category: 'Text',
    inputs: [{ name: 'in', type: 'any', default: '' }],
    outputs: [{ name: 'out', type: 'number' }],
    run: (i) => ({ out: (i.in as { length?: number })?.length ?? 0 }),
  },

  // Lists
  {
    type: 'list/range',
    title: 'Range',
    category: 'Lists',
    inputs: [
      { name: 'start', type: 'number', default: 0 },
      { name: 'end', type: 'number', default: 6.283 },
      { name: 'count', type: 'number', default: 48 },
    ],
    outputs: [{ name: 'list', type: 'list' }],
    run: ({ start, end, count }) => {
      const n = Math.max(2, Math.min(5000, Math.round(num(count, 2))));
      const a = num(start);
      const b = num(end);
      return { list: Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)) };
    },
  },
  {
    type: 'list/map',
    title: 'Map',
    category: 'Lists',
    color: '#c2410c',
    description: 'Applies an expression to every item x (index i). Extra input k is available too.',
    params: [{ name: 'expr', label: 'x →', kind: 'text', default: 'sin(x * k)' }],
    inputs: [
      { name: 'list', type: 'list', inline: false },
      { name: 'k', type: 'number', default: 1 },
    ],
    outputs: [{ name: 'list', type: 'list' }],
    run: ({ list, k }, { params }) => {
      const f = compileExpression(['x', 'i', 'k'], String(params.expr));
      return { list: (Array.isArray(list) ? list : []).map((x, i) => f(x, i, k)) };
    },
  },
  {
    type: 'list/reduce',
    title: 'Aggregate',
    category: 'Lists',
    params: [{ name: 'op', kind: 'select', default: 'sum', options: ['sum', 'mean', 'min', 'max', 'count'] }],
    inputs: [{ name: 'list', type: 'list', inline: false }],
    outputs: [{ name: 'out', type: 'number' }],
    run: ({ list }, { params }) => {
      const xs = (Array.isArray(list) ? list : []).map((v) => num(v));
      const sum = xs.reduce((a, b) => a + b, 0);
      const op = params.op;
      return {
        out:
          op === 'count' ? xs.length
          : op === 'mean' ? (xs.length ? sum / xs.length : 0)
          : op === 'min' ? Math.min(...xs)
          : op === 'max' ? Math.max(...xs)
          : sum,
      };
    },
  },

  // Async
  {
    type: 'async/delay',
    title: 'Delay',
    category: 'Async',
    color: '#7c3aed',
    description: 'Waits, then passes its input through. Shows async evaluation.',
    params: [{ name: 'ms', kind: 'number', default: 600, min: 0, max: 3000, step: 50 }],
    inputs: [{ name: 'in', type: 'any', default: 0 }],
    outputs: [{ name: 'out', type: 'any' }],
    run: async ({ in: v }, { params, signal }) => {
      await sleep(num(params.ms), signal);
      return { out: v };
    },
  },

  // Display
  {
    type: 'view/display',
    title: 'Display',
    category: 'Display',
    color: '#2563eb',
    inputs: [{ name: 'value', type: 'any', inline: false }],
    run: ({ value }) => ({ value }),
    view: textView,
  },
  {
    type: 'view/plot',
    title: 'Plot',
    category: 'Display',
    color: '#2563eb',
    inputs: [{ name: 'value', type: 'list', inline: false }],
    run: ({ value }) => ({ value }),
    view: plotView,
  },
];
