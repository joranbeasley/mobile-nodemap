import type { Graph } from './graph.js';
import type {
  NodeInstance,
  NodeResult,
  NodeType,
  ParamDef,
  ParamKind,
  PortDef,
  PortRef,
  PortType,
  PortTypeDef,
  RunContext,
} from './types.js';

// ------------------------------------------------------------------ authoring shorthand

/** A port written as just its type (`'number'`) or as a PortDef without its name. */
export type PortSpec = PortType | Omit<PortDef, 'name'>;
/** Ports as a list of PortDefs, or as `{ name: spec }` (the order of keys is the order on the node). */
export type PortsSpec = readonly PortDef[] | { readonly [name: string]: PortSpec };

type TypeOfSpec<S> = S extends string ? S : S extends { type: infer T } ? T : 'any';
type ValueFor<T> = T extends 'number' ? number : T extends 'string' ? string : T extends 'boolean' ? boolean : T extends 'list' ? unknown[] : any;
type Many<S, V> = S extends { multiple: true } ? V[] : V;
/** The `inputs` object a run function receives, inferred from shorthand ports. */
export type InputValues<S> = S extends readonly PortDef[] ? Record<string, any> : { -readonly [K in keyof S]: Many<S[K], ValueFor<TypeOfSpec<S[K]>>> };
/** What a run function returns, inferred from shorthand ports. */
export type OutputValues<S> = S extends readonly PortDef[] ? Record<string, unknown> : { -readonly [K in keyof S]?: ValueFor<TypeOfSpec<S[K]>> };

/** A node type as authors write it: like NodeType, with shorthand ports and typed `run`. */
export interface NodeSpec<I extends PortsSpec = PortsSpec, O extends PortsSpec = PortsSpec>
  extends Omit<NodeType, 'inputs' | 'outputs' | 'run'> {
  inputs?: I;
  outputs?: O;
  run?: (inputs: InputValues<I>, ctx: RunContext) => OutputValues<O> | Promise<OutputValues<O>>;
}

/** Anything `Registry.define` accepts: a NodeType, or a spec with shorthand ports. */
export type NodeInput = NodeSpec;

export function normalizePorts(spec: PortsSpec | undefined): PortDef[] | undefined {
  if (!spec) return undefined;
  if (Array.isArray(spec)) return spec.map((p) => ({ ...p }));
  return Object.entries(spec as Record<string, PortSpec>).map(([name, p]) =>
    typeof p === 'string' ? { name, type: p } : { name, ...p },
  );
}

/** Turn an authoring spec into a plain NodeType. */
export function normalizeNode(def: NodeInput | NodeType): NodeType {
  const d = def as NodeSpec<any, any>;
  return { ...d, inputs: normalizePorts(d.inputs), outputs: normalizePorts(d.outputs) } as NodeType;
}

/**
 * Define a node type with typed ports:
 *
 *   defineNode({
 *     type: 'math/lerp',
 *     inputs: { a: 'number', b: 'number', t: { type: 'number', default: 0.5 } },
 *     outputs: { out: 'number' },
 *     run: ({ a, b, t }) => ({ out: a + (b - a) * t }),   // a, b, t: number
 *   })
 */
export function defineNode<const I extends PortsSpec = {}, const O extends PortsSpec = {}>(spec: NodeSpec<I, O>): NodeType {
  return normalizeNode(spec as unknown as NodeInput);
}

const mergeByName = <T extends { name: string }>(base: T[] | undefined, patch: T[] | undefined): T[] | undefined => {
  if (!patch) return base;
  const out = [...(base ?? [])];
  for (const p of patch) {
    const i = out.findIndex((b) => b.name === p.name);
    if (i >= 0) out[i] = { ...out[i], ...p };
    else out.push(p);
  }
  return out;
};

/**
 * Derive a node type from another. Ports and params are merged by name (patch wins, new ones
 * are appended); everything else is overridden.
 *
 *   const loudAdd = extendNode(add, { type: 'demo/loud-add', title: 'Loud add', color: 'red' });
 */
export function extendNode(base: NodeType, patch: NodeSpec<any, any> & { type: string }): NodeType {
  const p = normalizeNode(patch);
  return {
    ...base,
    ...p,
    inputs: mergeByName(base.inputs, p.inputs),
    outputs: mergeByName(base.outputs, p.outputs),
    params: mergeByName(base.params as ParamDef[] | undefined, p.params as ParamDef[] | undefined),
    meta: { ...base.meta, ...p.meta },
  };
}

// ------------------------------------------------------------------ packs, rules, engines

/** A bundle third parties publish: nodes plus the port types and param editors they need. */
export interface NodePack {
  id: string;
  title?: string;
  version?: string;
  nodes?: NodeInput[];
  portTypes?: PortTypeDef[];
  paramKinds?: ParamKind[];
  /** Editor plugins: installed by every editor showing a map that uses this pack. */
  editorPlugins?: EditorPlugin[];
  /** Extra allowed connections between port types, as [from, to]. */
  conversions?: [PortType, PortType][];
  /** CSS for this pack's views and controls. The editor adds it once per document or shadow root. */
  css?: string;
  /** Anything else, with full access to the registry. */
  setup?(registry: Registry): void;
}

export const definePack = (pack: NodePack): NodePack => pack;

export interface GraphIssue {
  level: 'error' | 'warning';
  message: string;
  /** The node it is about, if any. */
  node?: string;
}

export interface ConnectionEnd extends PortRef {
  def: PortDef;
  nodeType: string;
}

/** Structural rules a graph type imposes on its maps. */
/**
 * Behaviour added to the editor by a pack or graph type: toolbar buttons, keyboard shortcuts,
 * panels, reactions to selection or views. `install` gets the NodeEditor (typed loosely here
 * so the core stays DOM-free) and may return a function that undoes it.
 *
 *   { id: 'acme/export', install: (editor) => editor.addToolbarButton({ id: 'export', label: 'Export', icon: '⇩', run: () => … }) }
 */
export interface EditorPlugin<Editor = any> {
  id: string;
  install(editor: Editor): void | (() => void);
}

export interface GraphRules {
  /** Allow wires that form loops (dataflow maps can't run them; network maps need them). Default false. */
  allowCycles?: boolean;
  /** Veto adding a node of this type (e.g. "only one output"). The add menu hides vetoed types. */
  canAddNode?: (type: string, graph: Graph) => string | null | undefined | void;
  /** Check a whole map: problems to show people before they run, save or compile it. */
  validate?: (graph: Graph) => GraphIssue[];
  /** Veto a connection: return a reason to block it, or nothing to allow it. */
  canConnect?: (from: ConnectionEnd, to: ConnectionEnd, graph: Graph) => string | null | undefined | void;
}

export interface EngineContext {
  graph: Graph;
  registry: Registry;
  /** External inputs passed to run(). */
  inputs: Record<string, unknown>;
  signal: AbortSignal;
  /** Show a node's result (status, outputs, error) in the editor. */
  publish(nodeId: string, result: NodeResult): void;
}

/**
 * Replaces the default dataflow evaluation for a graph type. A simulation, a solver, a
 * network analysis or a call to a remote service all fit here.
 */
export interface GraphEngine {
  /** Shown in tools; e.g. "Network reachability". */
  name?: string;
  /** Whether maps of this type can be called as functions (graph inputs/outputs). Default false. */
  callable?: boolean;
  run(ctx: EngineContext): Promise<{ outputs?: Record<string, unknown> } | void>;
}

// ------------------------------------------------------------------ registry

const PRIMITIVES = new Set(['number', 'string', 'boolean']);

/**
 * Everything a map can use: node types, port types, param editors, connection rules and an
 * optional engine. Usually built from a graph type (`graphType.createRegistry()`), but you can
 * assemble one by hand: `new Registry().use(myPack)`.
 */
export class Registry {
  /** Graph type id, written into saved JSON. */
  id?: string;
  title?: string;
  rules: GraphRules = {};
  engine?: GraphEngine;
  private types = new Map<string, NodeType>();
  private compat = new Map<string, Set<string>>();
  private portTypeDefs = new Map<string, PortTypeDef>();
  private paramKindDefs = new Map<string, ParamKind>();
  /** Editor plugins contributed by packs (see EditorPlugin). */
  editorPlugins: EditorPlugin[] = [];
  private packIds = new Set<string>();
  private css = new Map<string, string>();

  constructor(types: NodeInput[] = []) {
    types.forEach((t) => this.define(t));
  }

  define(def: NodeInput): this {
    if (!def.type) throw new Error('Node type needs a `type` id');
    this.types.set(def.type, normalizeNode(def));
    return this;
  }

  /** Remove node types by id; `'math/*'` removes a whole namespace. */
  remove(...patterns: string[]): this {
    for (const pat of patterns) {
      if (pat.endsWith('*')) for (const id of [...this.types.keys()]) id.startsWith(pat.slice(0, -1)) && this.types.delete(id);
      else this.types.delete(pat);
    }
    return this;
  }

  /** Add node types, a `{ nodes }` object, or a NodePack (with its port types, param kinds and conversions). */
  use(defs: NodeInput[] | NodePack | { nodes: NodeInput[] }): this {
    if (Array.isArray(defs)) {
      defs.forEach((d) => this.define(d));
      return this;
    }
    const pack = defs as NodePack;
    pack.portTypes?.forEach((p) => this.definePortType(p));
    pack.paramKinds?.forEach((k) => this.defineParamKind(k));
    pack.editorPlugins?.forEach((p) => {
      if (!this.editorPlugins.some((x) => x.id === p.id)) this.editorPlugins.push(p);
    });
    pack.conversions?.forEach(([a, b]) => this.allowConversion(a, b));
    pack.nodes?.forEach((d) => this.define(d));
    if (pack.css) this.css.set(pack.id ?? `pack-${this.css.size}`, pack.css);
    pack.setup?.(this);
    if (pack.id) this.packIds.add(pack.id);
    return this;
  }

  /** Stylesheets contributed by packs, keyed by pack id. */
  styles(): [string, string][] {
    return [...this.css];
  }

  /** Ids of the packs installed with use(). */
  get packs(): string[] {
    return [...this.packIds];
  }

  get(type: string): NodeType | undefined {
    return this.types.get(type);
  }

  require(type: string): NodeType {
    const t = this.types.get(type);
    if (!t) throw new Error(`Unknown node type "${type}"`);
    return t;
  }

  list(): NodeType[] {
    return [...this.types.values()];
  }

  categories(): Map<string, NodeType[]> {
    const out = new Map<string, NodeType[]>();
    for (const t of this.types.values()) {
      const c = t.category ?? 'General';
      (out.get(c) ?? out.set(c, []).get(c)!).push(t);
    }
    return out;
  }

  definePortType(def: PortTypeDef): this {
    this.portTypeDefs.set(def.id, def);
    return this;
  }

  portType(id: PortType | undefined): PortTypeDef | undefined {
    return id ? this.portTypeDefs.get(id) : undefined;
  }

  portTypes(): PortTypeDef[] {
    return [...this.portTypeDefs.values()];
  }

  defineParamKind(kind: ParamKind): this {
    this.paramKindDefs.set(kind.kind, kind);
    return this;
  }

  paramKind(kind: string): ParamKind | undefined {
    return this.paramKindDefs.get(kind);
  }

  /** Allow values of type `from` to flow into ports of type `to` (e.g. number → string). */
  allowConversion(from: PortType, to: PortType): this {
    (this.compat.get(from) ?? this.compat.set(from, new Set()).get(from)!).add(to);
    return this;
  }

  isCompatible(from: PortType = 'any', to: PortType = 'any'): boolean {
    return (
      from === 'any' ||
      to === 'any' ||
      from === to ||
      !!this.compat.get(from)?.has(to) ||
      !!this.portTypeDefs.get(to)?.accepts?.includes(from)
    );
  }

  /** Convert a value travelling from a port of type `from` into one of type `to`. */
  coerce(value: unknown, from: PortType = 'any', to: PortType = 'any'): unknown {
    if (from === to || value === undefined) return value;
    const def = this.portTypeDefs.get(to);
    return def?.coerce ? def.coerce(value) : value;
  }

  inputsOf(node: Pick<NodeInstance, 'type' | 'params'>): PortDef[] {
    const t = this.get(node.type);
    return t?.ports?.(node.params).inputs ?? t?.inputs ?? [];
  }

  outputsOf(node: Pick<NodeInstance, 'type' | 'params'>): PortDef[] {
    const t = this.get(node.type);
    return t?.ports?.(node.params).outputs ?? t?.outputs ?? [];
  }

  /** Copy everything from another registry into this one (later definitions win). */
  merge(other: Registry): this {
    other.types.forEach((t) => this.types.set(t.type, t));
    other.portTypeDefs.forEach((p) => this.portTypeDefs.set(p.id, p));
    other.paramKindDefs.forEach((k) => this.paramKindDefs.set(k.kind, k));
    other.editorPlugins.forEach((p) => {
      if (!this.editorPlugins.some((x) => x.id === p.id)) this.editorPlugins.push(p);
    });
    other.compat.forEach((tos, from) => tos.forEach((to) => this.allowConversion(from, to)));
    other.packIds.forEach((p) => this.packIds.add(p));
    other.css.forEach((c, id) => this.css.set(id, c));
    this.rules = { ...this.rules, ...other.rules };
    this.engine = other.engine ?? this.engine;
    return this;
  }

  /** An independent copy you can add to without touching this one. */
  extend(): Registry {
    const r = new Registry().merge(this);
    r.id = this.id;
    r.title = this.title;
    return r;
  }

  static isPrimitive(type: PortType = 'any'): boolean {
    return PRIMITIVES.has(type);
  }
}
