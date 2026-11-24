import { Graph } from '../core/graph.js';
import type { GraphEngine, Registry } from '../core/registry.js';
import type { GraphJSON, NodeInstance, NodeType, PortDef } from '../core/types.js';
import { INPUT_NODE, OUTPUT_NODE } from './evaluator.js';

/**
 * A compiled map: one plain async function. Arguments are the map's graph inputs by name;
 * the result holds its graph outputs by name.
 */
export type CompiledFunction<I extends Record<string, unknown> = Record<string, any>, O = Record<string, unknown>> = (
  inputs?: Partial<I>,
  options?: { signal?: AbortSignal },
) => Promise<O>;

/** Thrown by compiled functions; says which node failed. */
export class NodeRunError extends Error {
  constructor(
    readonly nodeId: string,
    readonly nodeType: string,
    message: string,
  ) {
    super(message);
    this.name = 'NodeRunError';
  }
}

/** Describe a graph's external interface from its graph/input and graph/output nodes (top to bottom). */
export function signature(graph: Graph | GraphJSON): { inputs: PortDef[]; outputs: PortDef[] } {
  const nodes = graph instanceof Graph ? [...graph.nodes.values()] : graph.nodes;
  const sorted = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    inputs: sorted
      .filter((n) => n.type === INPUT_NODE)
      .map((n) => ({ name: String(n.params.name), type: String(n.params.type ?? 'any'), default: n.params.value })),
    outputs: sorted.filter((n) => n.type === OUTPUT_NODE).map((n) => ({ name: String(n.params.name), type: 'any' })),
  };
}

// ------------------------------------------------------------------ plan

interface Binding {
  port: PortDef;
  sources: { node: string; port: string; type?: string }[];
  constant: unknown;
}
interface Step {
  node: NodeInstance;
  def: NodeType;
  bindings: Binding[];
  deps: string[];
}

/** Resolve every node's inputs once, in dependency order. Pure data: execution and code generation share it. */
export function plan(source: Graph | GraphJSON, registry: Registry): Step[] {
  const graph = source instanceof Graph ? source : Graph.fromJSON(source, registry);
  return graph.topoSort().map((node) => {
    const def = registry.get(node.type);
    if (!def) throw new NodeRunError(node.id, node.type, `Unknown node type "${node.type}"`);
    const incoming = graph.incoming(node.id);
    const bindings = registry.inputsOf(node).map((port) => {
      const sources = incoming
        .filter((e) => e.to.port === port.name)
        .sort((a, b) => graph.nodes.get(a.from.node)!.y - graph.nodes.get(b.from.node)!.y)
        .map((e) => ({ ...e.from, type: registry.outputsOf(graph.nodes.get(e.from.node)!).find((p) => p.name === e.from.port)?.type }));
      const constant = node.params[port.name] !== undefined ? node.params[port.name] : port.default ?? registry.portType(port.type)?.default;
      return { port, sources, constant };
    });
    return { node, def, bindings, deps: [...new Set(incoming.map((e) => e.from.node))] };
  });
}

/** Run a plan. Independent branches run concurrently. `onNode` sees each node's outputs as they arrive. */
export async function execute(
  steps: Step[],
  registry: Registry,
  inputs: Record<string, unknown>,
  signal: AbortSignal = new AbortController().signal,
  onNode?: (id: string, outputs: Record<string, unknown> | undefined, error?: string) => void,
): Promise<Map<string, Record<string, unknown>>> {
  const values = new Map<string, Record<string, unknown>>();
  const running = new Map<string, Promise<void>>();
  for (const step of steps) {
    running.set(
      step.node.id,
      Promise.all(step.deps.map((d) => running.get(d)!)).then(async () => {
        if (signal.aborted) throw new Error('Cancelled');
        const args: Record<string, unknown> = {};
        for (const b of step.bindings) {
          const vals = b.sources.map((s) => registry.coerce(values.get(s.node)?.[s.port], s.type, b.port.type));
          args[b.port.name] = b.port.multiple ? vals : b.sources.length ? vals[0] : b.constant;
        }
        try {
          const out = (await step.def.run?.(args, { node: step.node, params: step.node.params, graphInputs: inputs, signal })) ?? {};
          values.set(step.node.id, out);
          onNode?.(step.node.id, out);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          onNode?.(step.node.id, undefined, msg);
          throw err instanceof NodeRunError ? err : new NodeRunError(step.node.id, step.node.type, `${step.def.title ?? step.node.type}: ${msg}`);
        }
      }),
    );
  }
  await Promise.all(running.values());
  return values;
}

const identifier = (s: string) => s.replace(/[^\w$]/g, '_').replace(/^(\d)/, '_$1') || 'compiled';

/**
 * Turn a node map into one plain async function. It composes the nodes' run functions
 * directly (no evaluator, no editor), so it is cheap to call many times and safe to hand to
 * any code: `const area = compile(graph, registry); await area({ radius: 2 })`.
 */
export function compile<I extends Record<string, unknown> = Record<string, any>, O = Record<string, unknown>>(
  source: Graph | GraphJSON,
  registry: Registry,
  name = 'compiledMap',
): CompiledFunction<I, O> {
  const steps = plan(source, registry);
  const outs = steps.filter((s) => s.node.type === OUTPUT_NODE);
  const fn = async (inputs: Partial<I> = {}, options: { signal?: AbortSignal } = {}) => {
    const values = await execute(steps, registry, inputs as Record<string, unknown>, options.signal);
    const result: Record<string, unknown> = {};
    for (const o of outs) result[String(o.node.params.name ?? o.node.id)] = values.get(o.node.id)?.value;
    return result as O;
  };
  Object.defineProperty(fn, 'name', { value: identifier(name) });
  return fn;
}

/**
 * Compile a map that has exactly one graph output into a function that returns that value
 * directly: `const volume = compileFunction(graph, registry); await volume({ r: 2, h: 5 }) // 62.8`.
 */
export function compileFunction<I extends Record<string, unknown> = Record<string, any>, R = unknown>(
  source: Graph | GraphJSON,
  registry: Registry,
  name = 'compiledFunction',
): (inputs?: Partial<I>, options?: { signal?: AbortSignal }) => Promise<R> {
  const sig = signature(source);
  if (sig.outputs.length !== 1) throw new Error(`A function needs exactly one output; this map has ${sig.outputs.length}`);
  const inner = compile<I, Record<string, unknown>>(source, registry, name);
  const key = sig.outputs[0].name;
  const fn = async (inputs?: Partial<I>, options?: { signal?: AbortSignal }) => (await inner(inputs, options))[key] as R;
  Object.defineProperty(fn, 'name', { value: identifier(name) });
  return fn;
}

/** The default dataflow execution, packaged as an engine adapter (see ports). No caching. */
export const dataflowEngine: GraphEngine = {
  name: 'Dataflow',
  callable: true,
  async run({ graph, registry, inputs, signal, publish }) {
    const steps = plan(graph, registry);
    const outs = steps.filter((s) => s.node.type === OUTPUT_NODE);
    const values = await execute(steps, registry, inputs, signal, (id, outputs, error) =>
      publish(id, error ? { status: 'error', error } : { status: 'ok', outputs }),
    ).catch(() => new Map<string, Record<string, unknown>>());
    const outputs: Record<string, unknown> = {};
    for (const o of outs) outputs[String(o.node.params.name ?? o.node.id)] = values.get(o.node.id)?.value;
    return { outputs };
  },
};

/** Package a node map as a reusable node type (a user-defined function made of nodes). */
export function graphNode(opts: {
  type: string;
  title?: string;
  category?: string;
  color?: string;
  graph: Graph | GraphJSON;
  registry: Registry;
}): NodeType {
  const fn = compile(opts.graph, opts.registry, opts.title ?? opts.type);
  const sig = signature(opts.graph);
  return {
    type: opts.type,
    title: opts.title ?? opts.type,
    category: opts.category ?? 'Functions',
    color: opts.color,
    inputs: sig.inputs,
    outputs: sig.outputs,
    run: (inputs, ctx) => fn(inputs, { signal: ctx.signal }),
  };
}
