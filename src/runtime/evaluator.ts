import { Emitter } from '../core/emitter.js';
import type { Graph } from '../core/graph.js';
import type { Registry } from '../core/registry.js';
import type { NodeInstance, NodeResult, PortDef } from '../core/types.js';

export interface EvalReport {
  /** Values collected by `graph/output` nodes, keyed by their `name` param. */
  outputs: Record<string, unknown>;
  results: Map<string, NodeResult>;
  errors: { node: string; error: string }[];
  durationMs: number;
  /** Nodes that actually ran (the rest were reused from cache). */
  executed: string[];
  aborted: boolean;
}

export interface EvaluatorEvents extends Record<string, unknown> {
  start: { runId: number };
  node: { id: string; result: NodeResult };
  done: EvalReport;
}

export interface RunOptions {
  inputs?: Record<string, unknown>;
  /** Ignore the cache and re-run every node. */
  force?: boolean;
}

interface CacheEntry {
  params: string;
  inputs: unknown[];
  outputs: Record<string, unknown>;
}

export const INPUT_NODE = 'graph/input';
export const OUTPUT_NODE = 'graph/output';

const safeJson = (v: unknown) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(Math.random());
  }
};

/**
 * Executes a Graph using the run functions in a Registry.
 * - Nodes run as soon as their upstream nodes finish, so independent async branches run in parallel.
 * - Results are memoised per node: a node re-runs only when its params or input values change.
 * - Starting a new run aborts the previous one (ctx.signal fires).
 */
export class Evaluator extends Emitter<EvaluatorEvents> {
  readonly results = new Map<string, NodeResult>();
  graphInputs: Record<string, unknown> = {};
  private cache = new Map<string, CacheEntry>();
  private controller?: AbortController;
  private runId = 0;

  constructor(
    public graph: Graph,
    public registry: Registry,
  ) {
    super();
  }

  invalidate(nodeId?: string): void {
    if (nodeId) this.graph.downstream(nodeId).forEach((id) => this.cache.delete(id));
    else this.cache.clear();
  }

  async run(opts: RunOptions = {}): Promise<EvalReport> {
    if (opts.inputs) this.graphInputs = { ...opts.inputs };
    this.controller?.abort();
    const controller = (this.controller = new AbortController());
    const runId = ++this.runId;
    const started = now();
    const executed: string[] = [];
    const errors: EvalReport['errors'] = [];
    const results = new Map<string, NodeResult>();
    this.emit('start', { runId });

    // Drop cache entries for deleted nodes.
    for (const id of this.cache.keys()) if (!this.graph.nodes.has(id)) this.cache.delete(id);
    for (const id of this.results.keys()) if (!this.graph.nodes.has(id)) this.results.delete(id);

    // A graph type can bring its own engine (simulation, analysis, remote execution…).
    const engine = this.registry.engine;
    if (engine) {
      let outputs: Record<string, unknown> = {};
      try {
        const res = await engine.run({
          graph: this.graph,
          registry: this.registry,
          inputs: this.graphInputs,
          signal: controller.signal,
          publish: (id, result) => {
            results.set(id, result);
            if (result.status === 'error') errors.push({ node: id, error: result.error ?? 'Error' });
            if (controller.signal.aborted) return;
            this.results.set(id, result);
            this.emit('node', { id, result });
          },
        });
        outputs = res?.outputs ?? {};
        executed.push(...results.keys());
      } catch (err) {
        if (!controller.signal.aborted) errors.push({ node: '', error: err instanceof Error ? err.message : String(err) });
      }
      const report: EvalReport = { outputs, results, errors, durationMs: now() - started, executed, aborted: controller.signal.aborted };
      if (!report.aborted) this.emit('done', report);
      return report;
    }

    const order = this.graph.topoSort();
    const pending = new Map<string, Promise<NodeResult>>();

    const publish = (id: string, result: NodeResult) => {
      results.set(id, result);
      if (controller.signal.aborted) return;
      this.results.set(id, result);
      this.emit('node', { id, result });
    };

    for (const node of order) {
      const incoming = this.graph.incoming(node.id);
      const deps = incoming.map((e) => pending.get(e.from.node)!);
      pending.set(
        node.id,
        Promise.all(deps).then(async (): Promise<NodeResult> => {
          if (controller.signal.aborted) return { status: 'skipped' };
          const upstreamFailed = incoming.some((e) => {
            const r = results.get(e.from.node);
            return r?.status === 'error' || r?.status === 'skipped';
          });
          if (upstreamFailed) {
            const r: NodeResult = { status: 'skipped', error: 'Waiting on an upstream error' };
            publish(node.id, r);
            return r;
          }
          const r = await this.runNode(node, results, controller.signal, opts.force ?? false, executed);
          if (r.status === 'error') errors.push({ node: node.id, error: r.error! });
          publish(node.id, r);
          return r;
        }),
      );
    }

    await Promise.all(pending.values());

    const outputs: Record<string, unknown> = {};
    for (const node of order) {
      if (node.type !== OUTPUT_NODE) continue;
      const r = results.get(node.id);
      outputs[String(node.params.name ?? node.id)] = r?.outputs?.value;
    }

    const report: EvalReport = {
      outputs,
      results,
      errors,
      durationMs: now() - started,
      executed,
      aborted: controller.signal.aborted,
    };
    if (!report.aborted) this.emit('done', report);
    return report;
  }

  /** Re-run automatically whenever the graph changes. Returns a function that stops watching. */
  live(debounceMs = 30): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = this.graph.on('change', (c) => {
      if (c.kind === 'node:move') return;
      clearTimeout(timer);
      timer = setTimeout(() => this.run().catch(() => {}), debounceMs);
    });
    this.run().catch(() => {});
    return () => {
      clearTimeout(timer);
      off();
    };
  }

  /** Resolve the value each input port of `node` receives. */
  inputValues(node: NodeInstance, results: Map<string, NodeResult> = this.results): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const edges = this.graph.incoming(node.id);
    const valueOf = (e: (typeof edges)[number], port: PortDef) => {
      const src = this.graph.nodes.get(e.from.node)!;
      const outType = this.registry.outputsOf(src).find((p) => p.name === e.from.port)?.type;
      return this.registry.coerce(results.get(e.from.node)?.outputs?.[e.from.port], outType, port.type);
    };
    for (const port of this.registry.inputsOf(node)) {
      const wired = edges.filter((e) => e.to.port === port.name);
      if (port.multiple) {
        // Collect every wire, top to bottom, so the order matches what people see.
        wired.sort((a, b) => this.graph.nodes.get(a.from.node)!.y - this.graph.nodes.get(b.from.node)!.y);
        values[port.name] = wired.map((e) => valueOf(e, port));
      } else values[port.name] = wired[0] ? valueOf(wired[0], port) : fallback(node, port, this.registry);
    }
    return values;
  }

  private async runNode(
    node: NodeInstance,
    results: Map<string, NodeResult>,
    signal: AbortSignal,
    force: boolean,
    executed: string[],
  ): Promise<NodeResult> {
    const def = this.registry.get(node.type);
    if (!def) return { status: 'error', error: `Unknown node type "${node.type}"` };
    const ports = this.registry.inputsOf(node);
    const values = this.inputValues(node, results);
    const paramsKey = safeJson(node.params) + (node.type === INPUT_NODE ? safeJson(this.graphInputs) : '');
    const inputArr = ports.map((p) => values[p.name]);

    const cached = this.cache.get(node.id);
    if (
      !force &&
      def.pure !== false &&
      cached &&
      cached.params === paramsKey &&
      cached.inputs.length === inputArr.length &&
      cached.inputs.every((v, i) => Object.is(v, inputArr[i]))
    ) {
      return { status: 'ok', outputs: cached.outputs, durationMs: 0 };
    }

    if (!def.run) return { status: 'ok', outputs: {} };
    const t0 = now();
    const running = this.results.get(node.id);
    if (!signal.aborted) this.emit('node', { id: node.id, result: { ...running, status: 'running' } });
    try {
      const outputs = (await def.run(values, {
        node,
        params: node.params,
        graphInputs: this.graphInputs,
        signal,
      })) ?? {};
      executed.push(node.id);
      this.cache.set(node.id, { params: paramsKey, inputs: inputArr, outputs });
      return { status: 'ok', outputs, durationMs: now() - t0 };
    } catch (err) {
      this.cache.delete(node.id);
      return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: now() - t0 };
    }
  }
}

function fallback(node: NodeInstance, port: PortDef, registry: Registry): unknown {
  if (node.params[port.name] !== undefined) return node.params[port.name];
  return port.default !== undefined ? port.default : registry.portType(port.type)?.default;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
