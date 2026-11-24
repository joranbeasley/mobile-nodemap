import { Graph } from '../core/graph.js';
import type { Registry } from '../core/registry.js';
import type { GraphJSON, NodeType, PortDef } from '../core/types.js';
import { Evaluator, INPUT_NODE, OUTPUT_NODE } from './evaluator.js';

export type CompiledGraph = ((inputs?: Record<string, unknown>) => Promise<Record<string, unknown>>) & {
  inputs: PortDef[];
  outputs: PortDef[];
};

/** Describe a graph's external interface from its graph/input and graph/output nodes. */
export function signature(graph: Graph | GraphJSON): { inputs: PortDef[]; outputs: PortDef[] } {
  const nodes = graph instanceof Graph ? [...graph.nodes.values()] : graph.nodes;
  const sorted = [...nodes].sort((a, b) => a.y - b.y);
  return {
    inputs: sorted
      .filter((n) => n.type === INPUT_NODE)
      .map((n) => ({ name: String(n.params.name), type: String(n.params.type ?? 'any'), default: n.params.value })),
    outputs: sorted
      .filter((n) => n.type === OUTPUT_NODE)
      .map((n) => ({ name: String(n.params.name), type: 'any' })),
  };
}

/**
 * Turn a node map into an async function: graph/input nodes become arguments,
 * graph/output nodes become the returned object. Throws if any node errors.
 */
export function compile(source: Graph | GraphJSON, registry: Registry): CompiledGraph {
  const json = source instanceof Graph ? source.toJSON() : source;
  const sig = signature(json);
  // One evaluator per compiled function keeps the memo cache warm between calls,
  // but calls are serialised so concurrent callers never abort each other.
  const graph = Graph.fromJSON(json, registry);
  const evaluator = new Evaluator(graph, registry);
  let queue: Promise<unknown> = Promise.resolve();
  const fn = (async (inputs: Record<string, unknown> = {}) => {
    const job = queue.then(() => evaluator.run({ inputs }));
    queue = job.catch(() => {});
    const report = await job;
    if (report.errors.length) {
      const e = report.errors[0];
      throw new Error(`Node ${e.node} failed: ${e.error}`);
    }
    return report.outputs;
  }) as CompiledGraph;
  fn.inputs = sig.inputs;
  fn.outputs = sig.outputs;
  return fn;
}

/** Package a node map as a reusable node type (a user-defined function made of nodes). */
export function graphNode(opts: {
  type: string;
  title?: string;
  category?: string;
  color?: string;
  graph: Graph | GraphJSON;
  registry: Registry;
}): NodeType {
  const fn = compile(opts.graph, opts.registry);
  return {
    type: opts.type,
    title: opts.title ?? opts.type,
    category: opts.category ?? 'Functions',
    color: opts.color,
    inputs: fn.inputs,
    outputs: fn.outputs,
    run: (inputs) => fn(inputs),
  };
}
