import { Emitter } from '../core/emitter.js';
import { Graph } from '../core/graph.js';
import { definePack, type NodePack, type Registry } from '../core/registry.js';
import type { GraphJSON, NodeType } from '../core/types.js';
import { compileFunction, signature } from '../runtime/compile.js';
import { emitSource } from '../runtime/codegen.js';
import { INPUT_NODE, OUTPUT_NODE } from '../runtime/evaluator.js';

export interface CustomNodeMeta {
  /** Node type id, e.g. 'lib/cylinder-volume'. */
  type: string;
  title: string;
  description?: string;
  category?: string;
  color?: string;
  icon?: string;
}

/**
 * Compile a function map (Input leaves, exactly one Output) into a node type. The node's
 * inputs are the map's Input nodes (top to bottom), its single output is the Output node,
 * and its run function is the compiled map.
 */
export function compileNode(source: Graph | GraphJSON, registry: Registry, meta: CustomNodeMeta): NodeType {
  const graph = source instanceof Graph ? source : Graph.fromJSON(source, registry);
  const errors = graph.validate().filter((i) => i.level === 'error');
  if (errors.length) throw new Error(`${meta.title}: ${errors.map((e) => e.message).join('; ')}`);
  const sig = signature(graph);
  if (sig.outputs.length !== 1) throw new Error(`${meta.title}: a custom node needs exactly one output (found ${sig.outputs.length})`);
  const fn = compileFunction(graph, registry, meta.title);
  const out = sig.outputs[0].name;
  const json = graph.toJSON();
  return {
    type: meta.type,
    title: meta.title,
    description: meta.description,
    category: meta.category ?? 'Library',
    color: meta.color,
    icon: meta.icon ?? 'λ',
    flavor: 'transform',
    inputs: sig.inputs.map((p) => ({ ...p, default: p.default })),
    outputs: [{ name: out, type: outputType(graph, registry) }],
    run: async (inputs, ctx) => ({ [out]: await fn(inputs, { signal: ctx.signal }) }),
    meta: { source: json, compiledFrom: registry.id },
  };
}

/** The type flowing into the Output node, when it is known. */
function outputType(graph: Graph, registry: Registry): string {
  const o = [...graph.nodes.values()].find((n) => n.type === OUTPUT_NODE);
  const e = o && graph.incoming(o.id)[0];
  if (!e) return 'any';
  return registry.outputsOf(graph.nodes.get(e.from.node)!).find((p) => p.name === e.from.port)?.type ?? 'any';
}

export interface LibraryEntry extends CustomNodeMeta {
  graph: GraphJSON;
  updatedAt: number;
}

export interface LibraryEvents extends Record<string, unknown> {
  change: LibraryEntry[];
}

/**
 * A collection of custom nodes built from function maps. It is plain JSON, so you can keep
 * it anywhere (see StoragePort) and share it. `toPack()` turns it into a NodePack any
 * registry or graph type can use.
 */
export class NodeLibrary extends Emitter<LibraryEvents> {
  private entries = new Map<string, LibraryEntry>();

  constructor(entries: LibraryEntry[] = []) {
    super();
    entries.forEach((e) => this.entries.set(e.type, e));
  }

  list(): LibraryEntry[] {
    return [...this.entries.values()];
  }

  get(type: string): LibraryEntry | undefined {
    return this.entries.get(type);
  }

  /** Replace every entry (e.g. after loading from storage). */
  load(entries: LibraryEntry[]): this {
    this.entries.clear();
    entries.forEach((e) => this.entries.set(e.type, e));
    this.emit('change', this.list());
    return this;
  }

  /** Add or replace an entry. Compiles it first against `registry` so broken maps never get in. */
  add(meta: CustomNodeMeta, graph: Graph | GraphJSON, registry: Registry): NodeType {
    const node = compileNode(graph, registry, meta);
    const json = graph instanceof Graph ? graph.toJSON() : graph;
    this.entries.set(meta.type, { ...meta, graph: structuredClone(json), updatedAt: Date.now() });
    this.emit('change', this.list());
    return node;
  }

  remove(type: string): void {
    if (this.entries.delete(type)) this.emit('change', this.list());
  }

  /** Source code for an entry: one standalone TypeScript function. */
  source(type: string, registry: Registry, lang: 'ts' | 'js' = 'ts'): string {
    const e = this.entries.get(type);
    if (!e) throw new Error(`No library entry "${type}"`);
    return emitSource(e.graph, registry, { name: camel(e.title), lang, single: true });
  }

  /**
   * A pack with every entry compiled against the registry it is installed into. Entries can
   * use earlier entries. One that no longer compiles is skipped with a warning.
   */
  toPack(id = 'library'): NodePack {
    return definePack({
      id,
      title: 'Library',
      setup: (registry) => {
        for (const e of this.entries.values()) {
          try {
            registry.define(compileNode(e.graph, registry, e));
          } catch (err) {
            console.warn(`Library node "${e.type}" skipped:`, err instanceof Error ? err.message : err);
          }
        }
      },
    });
  }

  toJSON(): LibraryEntry[] {
    return this.list();
  }

  static fromJSON(entries: LibraryEntry[]): NodeLibrary {
    return new NodeLibrary(entries);
  }
}

export const camel = (s: string) =>
  s
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join('') || 'customNode';

export { INPUT_NODE, OUTPUT_NODE };
