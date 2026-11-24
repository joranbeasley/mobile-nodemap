import { Emitter } from '../core/emitter.js';
import { Graph } from '../core/graph.js';
import { definePack, type NodePack, type Registry } from '../core/registry.js';
import type { GraphJSON, NodeType } from '../core/types.js';
import { compileFunction, signature } from '../runtime/compile.js';
import { emitSource } from '../runtime/codegen.js';
import { INPUT_NODE, OUTPUT_NODE } from '../runtime/evaluator.js';

/** What you must say about a node when you compile it. */
export interface CustomNodeMeta {
  /** Required. Shown as the node's title; also names the generated function (camelCased). */
  name: string;
  /** Optional. Shown in the add menu and the node's details. */
  description?: string;
  /** Node type id. Defaults to `lib/<name-as-slug>`. */
  type?: string;
  category?: string;
  color?: string;
  icon?: string;
}

/** A compiled node: its meta, where it came from, and how to get back to its source graph. */
export interface CustomNodeInfo extends Required<Pick<CustomNodeMeta, 'name' | 'type'>> {
  description?: string;
  /** The function map it was compiled from. */
  graph: GraphJSON;
}

export interface CompileNodeOptions {
  /** Offer "Edit in graph" in the node's details; called with the node's source graph. */
  onEdit?: (info: CustomNodeInfo) => void;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '') || 'node';

export const camel = (s: string) =>
  s
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase()))
    .join('')
    .replace(/^(\d)/, '_$1') || 'customNode';

/** Check and complete node meta. A name is required; everything else has a default. */
export function resolveMeta(meta: CustomNodeMeta): CustomNodeMeta & { type: string; name: string } {
  const name = typeof meta?.name === 'string' ? meta.name.trim() : '';
  if (!name) throw new Error('A custom node needs a name');
  const description = meta.description?.trim() || undefined;
  return { ...meta, name, description, type: meta.type ?? `lib/${slug(name)}` };
}

/**
 * Compile a function map (Input leaves, exactly one Output) into a node type. The node's
 * inputs are the map's Input nodes (top to bottom), its single output is the Output node,
 * and its run function is the compiled map. A `name` is required.
 *
 * The node's details (shown when you tap it in the editor) carry its JavaScript and, with
 * `options.onEdit`, an "Edit in graph" action that hands back the source graph.
 */
export function compileNode(source: Graph | GraphJSON, registry: Registry, meta: CustomNodeMeta, options: CompileNodeOptions = {}): NodeType {
  const m = resolveMeta(meta);
  const graph = source instanceof Graph ? source : Graph.fromJSON(source, registry);
  const errors = graph.validate().filter((i) => i.level === 'error');
  if (errors.length) throw new Error(`${m.name}: ${errors.map((e) => e.message).join('; ')}`);
  const sig = signature(graph);
  if (sig.outputs.length !== 1) throw new Error(`${m.name}: a custom node needs exactly one output (found ${sig.outputs.length})`);
  const fnName = camel(m.name);
  const fn = compileFunction(graph, registry, fnName);
  const out = sig.outputs[0].name;
  const json = graph.toJSON();
  const info: CustomNodeInfo = { name: m.name, type: m.type, description: m.description, graph: json };
  let js: string | undefined;
  return {
    type: m.type,
    title: m.name,
    description: m.description,
    category: m.category ?? 'Library',
    color: m.color,
    icon: m.icon ?? 'λ',
    flavor: 'transform',
    inputs: sig.inputs.map((p) => ({ ...p })),
    outputs: [{ name: out, type: outputType(graph, registry) }],
    run: async (inputs, ctx) => ({ [out]: await fn(inputs, { signal: ctx.signal }) }),
    details: () => ({
      title: m.name,
      subtitle: m.description,
      code: { lang: 'js', text: (js ??= emitSource(json, registry, { name: fnName, lang: 'js', single: true })) },
      actions: options.onEdit ? [{ label: 'Edit in graph', primary: true, run: () => options.onEdit!(structuredClone(info)) }] : [],
    }),
    meta: { source: json, compiledFrom: registry.id, custom: true },
  };
}

/** The type flowing into the Output node, when it is known. */
function outputType(graph: Graph, registry: Registry): string {
  const o = [...graph.nodes.values()].find((n) => n.type === OUTPUT_NODE);
  const e = o && graph.incoming(o.id)[0];
  if (!e) return 'any';
  return registry.outputsOf(graph.nodes.get(e.from.node)!).find((p) => p.name === e.from.port)?.type ?? 'any';
}

export interface LibraryEntry extends CustomNodeInfo {
  category?: string;
  color?: string;
  icon?: string;
  updatedAt: number;
}

export interface LibraryEvents extends Record<string, unknown> {
  change: LibraryEntry[];
  /** Someone chose "Edit in graph" on a library node: open `entry.graph` in a function builder. */
  edit: LibraryEntry;
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
  load(entries: (LibraryEntry & { title?: string })[]): this {
    this.entries.clear();
    entries.forEach((e) => this.entries.set(e.type, { ...e, name: e.name ?? e.title ?? e.type }));
    this.emit('change', this.list());
    return this;
  }

  /**
   * Add or replace an entry. A `name` is required; the description is optional. The map is
   * compiled first against `registry`, so broken maps never get in.
   */
  add(meta: CustomNodeMeta, graph: Graph | GraphJSON, registry: Registry): NodeType {
    const m = resolveMeta(meta);
    const node = compileNode(graph, registry, m);
    const json = graph instanceof Graph ? graph.toJSON() : graph;
    this.entries.set(m.type, {
      type: m.type,
      name: m.name,
      description: m.description,
      category: m.category,
      color: m.color,
      icon: m.icon,
      graph: structuredClone(json),
      updatedAt: Date.now(),
    });
    this.emit('change', this.list());
    return node;
  }

  remove(type: string): void {
    if (this.entries.delete(type)) this.emit('change', this.list());
  }

  /** Ask the host to open an entry's source graph (fires `edit`). */
  edit(type: string): void {
    const e = this.entries.get(type);
    if (e) this.emit('edit', structuredClone(e));
  }

  /** Source code for an entry: one standalone function. */
  source(type: string, registry: Registry, lang: 'ts' | 'js' = 'ts'): string {
    const e = this.entries.get(type);
    if (!e) throw new Error(`No library entry "${type}"`);
    return emitSource(e.graph, registry, { name: camel(e.name), lang, single: true });
  }

  /**
   * A pack with every entry compiled against the registry it is installed into. Entries can
   * use earlier entries. One that no longer compiles is skipped with a warning. Each node's
   * details offer "Edit in graph", which fires this library's `edit` event.
   */
  toPack(id = 'library'): NodePack {
    return definePack({
      id,
      title: 'Library',
      setup: (registry) => {
        for (const e of this.entries.values()) {
          try {
            registry.define(compileNode(e.graph, registry, e, { onEdit: () => this.edit(e.type) }));
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

  /** Load saved entries. Entries saved before names were required fall back to their `title`. */
  static fromJSON(entries: (LibraryEntry & { title?: string })[]): NodeLibrary {
    return new NodeLibrary(entries.map((e) => ({ ...e, name: e.name ?? e.title ?? e.type })));
  }
}

export { INPUT_NODE, OUTPUT_NODE };
