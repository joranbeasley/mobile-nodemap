import { defineGraphType } from '../core/graph-type.js';
import type { Graph } from '../core/graph.js';
import type { GraphIssue } from '../core/registry.js';
import { INPUT_NODE, OUTPUT_NODE } from '../runtime/evaluator.js';
import { mathGraph } from './math.js';

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** The rules of a function map, as issues people can fix one by one. */
export function functionIssues(graph: Graph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodes = [...graph.nodes.values()];
  const outs = nodes.filter((n) => n.type === OUTPUT_NODE);
  const ins = nodes.filter((n) => n.type === INPUT_NODE);
  if (!outs.length) issues.push({ level: 'error', message: 'Add an Output node: a function returns exactly one value' });
  if (outs.length > 1) outs.slice(1).forEach((o) => issues.push({ level: 'error', message: 'Only one Output is allowed', node: o.id }));
  for (const o of outs) if (!graph.incoming(o.id).length) issues.push({ level: 'error', message: 'Connect a value to the Output', node: o.id });
  const seen = new Set<string>();
  for (const i of ins) {
    const name = String(i.params.name ?? '');
    if (!IDENT.test(name)) issues.push({ level: 'error', message: `Input name "${name}" must be a valid identifier`, node: i.id });
    else if (seen.has(name)) issues.push({ level: 'error', message: `Two inputs are called "${name}"`, node: i.id });
    seen.add(name);
  }
  // Nodes that do not feed the output are dead code.
  if (outs[0]) {
    const used = new Set<string>();
    const stack = [outs[0].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (used.has(id)) continue;
      used.add(id);
      graph.incoming(id).forEach((e) => stack.push(e.from.node));
    }
    const unused = nodes.filter((n) => !used.has(n.id));
    if (unused.length) issues.push({ level: 'warning', message: `${unused.length} node${unused.length > 1 ? 's do' : ' does'} not affect the output` });
    // Leaves feeding the output that are not Inputs are constants: say so.
    const constants = nodes.filter((n) => used.has(n.id) && n.type !== INPUT_NODE && !graph.incoming(n.id).length && graph.registry?.inputsOf(n).length === 0);
    if (constants.length) issues.push({ level: 'warning', message: `${constants.length} leaf node${constants.length > 1 ? 's are' : ' is'} a constant, not an input` });
  }
  return issues;
}

/**
 * A canvas for building custom nodes. Input leaves are the function's arguments (top to
 * bottom) and exactly one Output is its result. compileNode() turns the map into a node type
 * that can go into a NodeLibrary.
 */
export const functionGraph = defineGraphType({
  id: 'function',
  title: 'Function builder',
  description: 'Build a custom node: Inputs are its arguments, the single Output is its result.',
  icon: 'λ',
  extends: [mathGraph],
  rules: {
    canAddNode: (type, graph) =>
      type === OUTPUT_NODE && [...graph.nodes.values()].some((n) => n.type === OUTPUT_NODE) ? 'A function has exactly one Output' : null,
    validate: functionIssues,
  },
  setup(registry) {
    const input = registry.get(INPUT_NODE)!;
    const output = registry.get(OUTPUT_NODE)!;
    registry.define({ ...input, title: 'Input', category: 'Function', description: 'An argument of the function', flavor: 'source' });
    registry.define({ ...output, title: 'Output', category: 'Function', description: 'What the function returns (exactly one)', flavor: 'sink' });
  },
  editor: { wires: 'smart' },
  examples: [
    {
      id: 'cylinder',
      name: 'Cylinder volume',
      description: 'Two Inputs, one Output. Open “Build” to turn it into a node for the library.',
      graph: {
        version: 1,
        type: 'function',
        nodes: [
          { id: 'r', type: INPUT_NODE, x: 0, y: 0, params: { name: 'radius', type: 'number', value: 2 } },
          { id: 'h', type: INPUT_NODE, x: 0, y: 180, params: { name: 'height', type: 'number', value: 5 } },
          { id: 'area', type: 'math/expression', x: 260, y: 0, params: { vars: 'r', expr: 'PI * r ** 2' } },
          { id: 'vol', type: 'math/multiply', x: 520, y: 60, params: {} },
          { id: 'out', type: OUTPUT_NODE, x: 780, y: 80, params: { name: 'volume' } },
        ],
        edges: [
          { id: '1', from: { node: 'r', port: 'value' }, to: { node: 'area', port: 'r' } },
          { id: '2', from: { node: 'area', port: 'out' }, to: { node: 'vol', port: 'a' } },
          { id: '3', from: { node: 'h', port: 'value' }, to: { node: 'vol', port: 'b' } },
          { id: '4', from: { node: 'vol', port: 'out' }, to: { node: 'out', port: 'value' } },
        ],
      },
    },
    {
      id: 'bmi',
      name: 'BMI',
      description: 'Body-mass index from kilograms and centimetres, rounded to one decimal.',
      graph: {
        version: 1,
        type: 'function',
        nodes: [
          { id: 'kg', type: INPUT_NODE, x: 0, y: 0, params: { name: 'kg', type: 'number', value: 70 } },
          { id: 'cm', type: INPUT_NODE, x: 0, y: 180, params: { name: 'cm', type: 'number', value: 175 } },
          { id: 'e', type: 'math/expression', x: 260, y: 40, params: { vars: 'kg, cm', expr: 'round(kg / (cm / 100) ** 2 * 10) / 10' } },
          { id: 'out', type: OUTPUT_NODE, x: 540, y: 60, params: { name: 'bmi' } },
        ],
        edges: [
          { id: '1', from: { node: 'kg', port: 'value' }, to: { node: 'e', port: 'kg' } },
          { id: '2', from: { node: 'cm', port: 'value' }, to: { node: 'e', port: 'cm' } },
          { id: '3', from: { node: 'e', port: 'out' }, to: { node: 'out', port: 'value' } },
        ],
      },
    },
  ],
});
