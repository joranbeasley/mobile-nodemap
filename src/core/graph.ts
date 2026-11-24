import { Emitter } from './emitter.js';
import type { Registry } from './registry.js';
import type { Edge, GraphJSON, NodeInstance, PortRef } from './types.js';

export type GraphChange =
  | { kind: 'node:add'; node: NodeInstance }
  | { kind: 'node:remove'; node: NodeInstance }
  | { kind: 'node:move'; node: NodeInstance }
  | { kind: 'node:params'; node: NodeInstance; name: string }
  | { kind: 'edge:add'; edge: Edge }
  | { kind: 'edge:remove'; edge: Edge }
  | { kind: 'load' };

export interface GraphEvents extends Record<string, unknown> {
  change: GraphChange;
}

export class ConnectionError extends Error {}

let counter = 0;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * The node map data model: nodes with positions and params, and edges between ports.
 * Inputs accept one edge (connecting again replaces it); outputs fan out freely.
 * Pass a Registry to get port validation and type checks on `connect()`.
 */
export class Graph extends Emitter<GraphEvents> {
  readonly nodes = new Map<string, NodeInstance>();
  readonly edges = new Map<string, Edge>();
  meta: Record<string, unknown> = {};

  constructor(public registry?: Registry) {
    super();
  }

  addNode(type: string, init: Partial<Omit<NodeInstance, 'type'>> = {}): NodeInstance {
    const def = this.registry?.get(type);
    if (this.registry && !def) throw new Error(`Unknown node type "${type}"`);
    const params: Record<string, unknown> = {};
    def?.params?.forEach((p) => {
      if (p.default !== undefined) params[p.name] = p.default;
    });
    const node: NodeInstance = {
      id: init.id ?? uid('n'),
      type,
      x: init.x ?? 0,
      y: init.y ?? 0,
      params: { ...params, ...init.params },
      ...(init.label ? { label: init.label } : {}),
      ...(def?.version ? { v: def.version } : {}),
    };
    const extra = def?.onCreate?.(node);
    if (extra) Object.assign(node.params, extra);
    if (this.nodes.has(node.id)) throw new Error(`Duplicate node id "${node.id}"`);
    this.nodes.set(node.id, node);
    this.emit('change', { kind: 'node:add', node });
    return node;
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const e of [...this.edges.values()]) {
      if (e.from.node === id || e.to.node === id) this.disconnect(e.id);
    }
    this.nodes.delete(id);
    this.emit('change', { kind: 'node:remove', node });
  }

  moveNode(id: string, x: number, y: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.x = x;
    node.y = y;
    this.emit('change', { kind: 'node:move', node });
  }

  setParam(id: string, name: string, value: unknown): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.params[name] = value;
    this.emit('change', { kind: 'node:params', node, name });
    this.pruneDanglingEdges(id);
  }

  /** Returns a reason the connection is invalid, or null if it can be made. */
  canConnect(from: PortRef, to: PortRef): string | null {
    const a = this.nodes.get(from.node);
    const b = this.nodes.get(to.node);
    if (!a || !b) return 'Node not found';
    if (a.id === b.id) return 'Cannot connect a node to itself';
    if (this.registry) {
      const out = this.registry.outputsOf(a).find((p) => p.name === from.port);
      const inp = this.registry.inputsOf(b).find((p) => p.name === to.port);
      if (!out) return `No output "${from.port}" on ${a.type}`;
      if (!inp) return `No input "${to.port}" on ${b.type}`;
      if (!this.registry.isCompatible(out.type, inp.type))
        return `Type mismatch: ${out.type ?? 'any'} → ${inp.type ?? 'any'}`;
      if (inp.multiple && [...this.edges.values()].some((e) => e.from.node === from.node && e.from.port === from.port && e.to.node === to.node && e.to.port === to.port))
        return 'Already connected';
      const veto = this.registry.rules.canConnect?.(
        { ...from, def: out, nodeType: a.type },
        { ...to, def: inp, nodeType: b.type },
        this,
      );
      if (veto) return veto;
    }
    if (!this.registry?.rules.allowCycles && this.reaches(b.id, a.id)) return 'That connection would create a loop';
    return null;
  }

  connect(from: PortRef, to: PortRef, id?: string): Edge {
    const reason = this.canConnect(from, to);
    if (reason) throw new ConnectionError(reason);
    // A plain input holds one wire, so a new one replaces it; `multiple` inputs collect them all.
    const port = this.registry?.inputsOf(this.nodes.get(to.node)!).find((p) => p.name === to.port);
    const existing = port?.multiple ? undefined : this.incoming(to.node).find((e) => e.to.port === to.port);
    if (existing) this.disconnect(existing.id);
    const edge: Edge = { id: id ?? uid('e'), from: { ...from }, to: { ...to } };
    this.edges.set(edge.id, edge);
    this.emit('change', { kind: 'edge:add', edge });
    return edge;
  }

  disconnect(edgeId: string): void {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.edges.delete(edgeId);
    this.emit('change', { kind: 'edge:remove', edge });
  }

  incoming(nodeId: string): Edge[] {
    return [...this.edges.values()].filter((e) => e.to.node === nodeId);
  }

  outgoing(nodeId: string): Edge[] {
    return [...this.edges.values()].filter((e) => e.from.node === nodeId);
  }

  /** True if `target` is reachable downstream from `start`. */
  reaches(start: string, target: string): boolean {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      this.outgoing(id).forEach((e) => stack.push(e.to.node));
    }
    return false;
  }

  /** Nodes in dependency order (Kahn's algorithm). Throws on cycles. */
  topoSort(subset?: Iterable<string>): NodeInstance[] {
    const ids = new Set(subset ?? this.nodes.keys());
    const indeg = new Map<string, number>();
    ids.forEach((id) => indeg.set(id, 0));
    for (const e of this.edges.values()) {
      if (ids.has(e.from.node) && ids.has(e.to.node)) indeg.set(e.to.node, indeg.get(e.to.node)! + 1);
    }
    const queue = [...ids].filter((id) => indeg.get(id) === 0);
    const out: NodeInstance[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      out.push(this.nodes.get(id)!);
      for (const e of this.outgoing(id)) {
        if (!ids.has(e.to.node)) continue;
        const d = indeg.get(e.to.node)! - 1;
        indeg.set(e.to.node, d);
        if (d === 0) queue.push(e.to.node);
      }
    }
    if (out.length !== ids.size) throw new Error('Graph contains a cycle');
    return out;
  }

  /** All nodes downstream of `id`, including itself. */
  downstream(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      this.outgoing(n).forEach((e) => stack.push(e.to.node));
    }
    return seen;
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.emit('change', { kind: 'load' });
  }

  toJSON(): GraphJSON {
    return {
      version: 1,
      ...(this.registry?.id ? { type: this.registry.id } : {}),
      nodes: [...this.nodes.values()].map((n) => ({ ...n, params: { ...n.params } })),
      edges: [...this.edges.values()].map((e) => ({ id: e.id, from: { ...e.from }, to: { ...e.to } })),
      ...(Object.keys(this.meta).length ? { meta: { ...this.meta } } : {}),
    };
  }

  load(json: GraphJSON): this {
    this.nodes.clear();
    this.edges.clear();
    this.meta = { ...json.meta };
    json.nodes.forEach((n) => this.nodes.set(n.id, this.migrate({ ...n, params: { ...n.params } })));
    json.edges.forEach((e) => this.edges.set(e.id, { id: e.id, from: { ...e.from }, to: { ...e.to } }));
    this.emit('change', { kind: 'load' });
    return this;
  }

  static fromJSON(json: GraphJSON, registry?: Registry): Graph {
    return new Graph(registry).load(json);
  }

  /** Upgrade a saved node whose type has a newer `version`. */
  private migrate(n: NodeInstance): NodeInstance {
    const def = this.registry?.get(n.type);
    if (!def?.version || (n.v ?? 1) >= def.version) return n;
    if (def.migrate) n.params = def.migrate(n.params, n.v ?? 1);
    n.v = def.version;
    return n;
  }

  private pruneDanglingEdges(nodeId: string): void {
    if (!this.registry) return;
    const node = this.nodes.get(nodeId)!;
    const ins = new Set(this.registry.inputsOf(node).map((p) => p.name));
    const outs = new Set(this.registry.outputsOf(node).map((p) => p.name));
    for (const e of [...this.edges.values()]) {
      if ((e.to.node === nodeId && !ins.has(e.to.port)) || (e.from.node === nodeId && !outs.has(e.from.port)))
        this.disconnect(e.id);
    }
  }
}
