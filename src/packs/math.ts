import { defineNode, definePack } from '../core/registry.js';
import { stdlib, compileExpression, formatValue } from '../runtime/stdlib.js';
import type { NodeResult } from '../core/types.js';

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Extra math nodes, written with the shorthand port syntax. */
const extras = [
  defineNode({
    type: 'math/constant',
    title: 'Constant',
    category: 'Values',
    icon: 'π',
    tags: ['pi', 'e', 'tau', 'phi'],
    params: [{ name: 'name', kind: 'select', default: 'π', options: ['π', 'τ', 'e', 'φ', '√2'] }],
    outputs: { value: 'number' },
    emit: (_, p) => ({ value: ({ π: 'Math.PI', τ: '(Math.PI * 2)', e: 'Math.E', φ: '((1 + Math.sqrt(5)) / 2)', '√2': 'Math.SQRT2' } as Record<string, string>)[String(p.name)] ?? 'NaN' }),
    run: (_, { params }) => ({
      value: ({ π: Math.PI, τ: Math.PI * 2, e: Math.E, φ: (1 + Math.sqrt(5)) / 2, '√2': Math.SQRT2 } as Record<string, number>)[String(params.name)],
    }),
  }),
  defineNode({
    type: 'math/remap',
    title: 'Remap',
    category: 'Math',
    description: 'Maps x from one range to another',
    tags: ['scale', 'lerp', 'range'],
    inputs: {
      x: { type: 'number', default: 0.5 },
      inMin: { type: 'number', default: 0 },
      inMax: { type: 'number', default: 1 },
      outMin: { type: 'number', default: 0 },
      outMax: { type: 'number', default: 100 },
    },
    outputs: { out: 'number' },
    run: ({ x, inMin, inMax, outMin, outMax }) => ({ out: outMin + ((x - inMin) / (inMax - inMin || 1)) * (outMax - outMin) }),
    emit: ({ x, inMin, inMax, outMin, outMax }) => ({ out: `${outMin} + ((${x} - ${inMin}) / ((${inMax} - ${inMin}) || 1)) * (${outMax} - ${outMin})` }),
  }),
  defineNode({
    type: 'math/sum',
    title: 'Sum all',
    category: 'Math',
    icon: 'Σ',
    description: 'Adds every number wired into it',
    inputs: { values: { type: 'number', multiple: true } },
    outputs: { out: 'number' },
    run: ({ values }) => ({ out: values.reduce((a, b) => a + num(b), 0) }),
    emit: ({ values }) => ({ out: `${values}.reduce((a, b) => a + Number(b), 0)` }),
  }),
  defineNode({
    type: 'view/plot-fn',
    title: 'Plot function',
    category: 'Display',
    color: '#2563eb',
    icon: 'ƒ',
    description: 'Draws y = f(x) over a range; k is a free parameter',
    tags: ['graph', 'chart', 'curve'],
    params: [{ name: 'expr', label: 'y =', kind: 'text', default: 'sin(x) * k', code: true }],
    inputs: { from: { type: 'number', default: -6.283 }, to: { type: 'number', default: 6.283 }, k: { type: 'number', default: 1 } },
    outputs: { points: 'list' },
    run: ({ from, to, k }, { params }) => {
      const f = compileExpression(['x', 'k'], String(params.expr));
      return { points: Array.from({ length: 120 }, (_, i) => num(f(from + ((to - from) * i) / 119, k), NaN)) };
    },
    view: {
      render(el: HTMLElement, r: NodeResult | undefined) {
        // Reuse the Plot node's renderer.
        stdlib.find((t) => t.type === 'view/plot')!.view!.render(el, r && { ...r, outputs: { value: r.outputs?.points } }, undefined as never);
      },
    },
  }),
];

/** Numbers, math, logic, text, lists, async and display nodes, plus graph inputs/outputs. */
export const mathPack = definePack({
  id: 'nodemap/math',
  title: 'Math',
  nodes: [...stdlib, ...extras],
  conversions: [
    ['number', 'string'],
    ['boolean', 'number'],
  ],
});

export { formatValue };
