import { defineGraphType } from '../core/graph-type.js';
import type { GraphJSON } from '../core/types.js';
import { mathPack } from '../packs/math.js';

const N = (id: string, type: string, x: number, y: number, params: Record<string, unknown> = {}) => ({ id, type, x, y, params });
const E = (from: string, fp: string, to: string, tp: string) => ({ id: `${from}.${fp}-${to}.${tp}`, from: { node: from, port: fp }, to: { node: to, port: tp } });
const map = (nodes: GraphJSON['nodes'], edges: GraphJSON['edges']): GraphJSON => ({ version: 1, type: 'math', nodes, edges });

/** Dataflow maths: values flow left to right through functions; maps can be called as functions. */
export const mathGraph = defineGraphType({
  id: 'math',
  title: 'Math',
  description: 'Dataflow: numbers, lists, logic and text flow through functions. Maps can be called as functions.',
  icon: 'ƒ',
  packs: [mathPack],
  editor: { wires: 'smart' },
  examples: [
    {
      id: 'waves',
      name: 'Waves',
      description: 'Drag the frequency slider. Only the nodes downstream of it re-run.',
      graph: map(
        [
          N('range', 'list/range', 0, 0, { start: 0, end: 12.566, count: 120 }),
          N('freq', 'value/number', 0, 220, { value: 1.5 }),
          N('map', 'list/map', 270, 40, { expr: 'sin(x * k) + 0.4 * sin(x * k * 3)' }),
          N('plot', 'view/plot', 540, 0),
          N('stat', 'list/reduce', 540, 230, { op: 'max' }),
          N('show', 'view/display', 800, 240),
        ],
        [E('range', 'list', 'map', 'list'), E('freq', 'value', 'map', 'k'), E('map', 'list', 'plot', 'value'), E('map', 'list', 'stat', 'list'), E('stat', 'out', 'show', 'value')],
      ),
    },
    {
      id: 'function',
      name: 'Function',
      description: 'Graph inputs and outputs make this map callable. Open “Call” to run it with arguments.',
      graph: map(
        [
          N('r', 'graph/input', 0, 0, { name: 'radius', type: 'number', value: 2 }),
          N('h', 'graph/input', 0, 200, { name: 'height', type: 'number', value: 5 }),
          N('area', 'math/expression', 270, 0, { vars: 'r', expr: 'PI * r ** 2' }),
          N('vol', 'math/multiply', 520, 120),
          N('outA', 'graph/output', 790, 0, { name: 'area' }),
          N('outV', 'graph/output', 790, 170, { name: 'volume' }),
          N('label', 'text/template', 520, 300, { template: 'Cylinder volume {a} for height {b}' }),
          N('outL', 'graph/output', 790, 330, { name: 'label' }),
        ],
        [
          E('r', 'value', 'area', 'r'),
          E('area', 'out', 'vol', 'a'),
          E('h', 'value', 'vol', 'b'),
          E('area', 'out', 'outA', 'value'),
          E('vol', 'out', 'outV', 'value'),
          E('vol', 'out', 'label', 'a'),
          E('h', 'value', 'label', 'b'),
          E('label', 'out', 'outL', 'value'),
        ],
      ),
    },
    {
      id: 'plot',
      name: 'Plot',
      description: 'Plot function draws y = f(x). Sum all takes any number of wires.',
      graph: map(
        [
          N('k', 'value/number', 0, 0, { value: 2 }),
          N('pi', 'math/constant', 0, 160, { name: 'π' }),
          N('neg', 'math/multiply', 250, 170, { b: -1 }),
          N('plot', 'view/plot-fn', 500, 0, { expr: 'sin(x * k) / x' }),
          N('sum', 'math/sum', 250, 330),
          N('one', 'value/number', 0, 300, { value: 1 }),
          N('show', 'view/display', 500, 330),
        ],
        [
          E('k', 'value', 'plot', 'k'),
          E('pi', 'value', 'neg', 'a'),
          E('neg', 'out', 'plot', 'from'),
          E('pi', 'value', 'plot', 'to'),
          E('k', 'value', 'sum', 'values'),
          E('pi', 'value', 'sum', 'values'),
          E('one', 'value', 'sum', 'values'),
          E('sum', 'out', 'show', 'value'),
        ],
      ),
    },
    {
      id: 'async',
      name: 'Async',
      description: 'Delay nodes are async. Independent branches run in parallel and edits cancel stale runs.',
      graph: map(
        [
          N('t', 'value/text', 0, 0, { value: 'nodes on a phone' }),
          N('d1', 'async/delay', 260, -20, { ms: 900 }),
          N('case', 'text/case', 520, 0, { mode: 'title' }),
          N('rnd', 'value/random', 0, 230, { min: 1, max: 100 }),
          N('d2', 'async/delay', 260, 230, { ms: 450 }),
          N('tpl', 'text/template', 780, 120, { template: '{a} · lucky number {b}' }),
          N('out', 'view/display', 1040, 140),
        ],
        [E('t', 'value', 'd1', 'in'), E('d1', 'out', 'case', 'text'), E('rnd', 'value', 'd2', 'in'), E('case', 'out', 'tpl', 'a'), E('d2', 'out', 'tpl', 'b'), E('tpl', 'out', 'out', 'value')],
      ),
    },
  ],
});
