import type { NodeType, PortDef, PortType, NodeInstance } from './types.js';

const PRIMITIVES = new Set(['number', 'string', 'boolean']);

/** Holds node type definitions. Shared by the editor (for ports/params) and the runtime (for run fns). */
export class Registry {
  private types = new Map<string, NodeType>();
  private compat = new Map<string, Set<string>>();

  constructor(types: NodeType[] = []) {
    types.forEach((t) => this.define(t));
  }

  define(def: NodeType): this {
    if (!def.type) throw new Error('Node type needs a `type` id');
    this.types.set(def.type, def);
    return this;
  }

  /** Define many node types at once. */
  use(defs: NodeType[] | { nodes: NodeType[] }): this {
    (Array.isArray(defs) ? defs : defs.nodes).forEach((d) => this.define(d));
    return this;
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

  /** Allow values of type `from` to flow into ports of type `to` (e.g. number → string). */
  allowConversion(from: PortType, to: PortType): this {
    (this.compat.get(from) ?? this.compat.set(from, new Set()).get(from)!).add(to);
    return this;
  }

  isCompatible(from: PortType = 'any', to: PortType = 'any'): boolean {
    return from === 'any' || to === 'any' || from === to || !!this.compat.get(from)?.has(to);
  }

  inputsOf(node: Pick<NodeInstance, 'type' | 'params'>): PortDef[] {
    const t = this.get(node.type);
    return t?.ports?.(node.params).inputs ?? t?.inputs ?? [];
  }

  outputsOf(node: Pick<NodeInstance, 'type' | 'params'>): PortDef[] {
    const t = this.get(node.type);
    return t?.ports?.(node.params).outputs ?? t?.outputs ?? [];
  }

  static isPrimitive(type: PortType = 'any'): boolean {
    return PRIMITIVES.has(type);
  }
}
