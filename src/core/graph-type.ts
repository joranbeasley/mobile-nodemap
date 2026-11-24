import { Registry, type GraphEngine, type GraphRules, type NodeInput, type NodePack } from './registry.js';
import type { GraphJSON, ParamKind, PortTypeDef } from './types.js';

export interface GraphExample {
  id: string;
  name: string;
  description?: string;
  graph: GraphJSON;
}

/** Defaults a graph type suggests to editors (the host can still override them). */
export interface GraphTypeEditorDefaults {
  wires?: 'smart' | 'curved';
  /** Tidy the map when it is first opened. */
  autoLayout?: boolean;
  /** Which way maps of this type flow (see the editor's `direction`). UML uses 'TB': parents on top. */
  direction?: 'auto' | 'LR' | 'TB';
}

export interface GraphTypeDef {
  /** Unique id, saved in JSON as `type`. Namespace third-party ids: 'acme/pipeline'. */
  id: string;
  title: string;
  description?: string;
  icon?: string;
  /** Start from other graph types (objects, or ids already registered). */
  extends?: (GraphType | string)[];
  packs?: NodePack[];
  nodes?: NodeInput[];
  portTypes?: PortTypeDef[];
  paramKinds?: ParamKind[];
  /** Drop inherited node types: ids, or 'namespace/*'. */
  exclude?: string[];
  rules?: GraphRules;
  /** Replace dataflow evaluation (simulation, analysis, remote execution…). */
  engine?: GraphEngine;
  editor?: GraphTypeEditorDefaults;
  /** Starter maps shown by tools and demos. */
  examples?: GraphExample[];
  /** Last word on the registry, after everything else is applied. */
  setup?(registry: Registry): void;
}

export interface GraphType extends GraphTypeDef {
  /** A fresh registry with everything this graph type (and what it extends) provides. */
  createRegistry(): Registry;
  /** A new graph type based on this one: `math.extend({ id: 'my-math', packs: [statsPack] })`. */
  extend(def: Omit<GraphTypeDef, 'extends'> & { extends?: GraphTypeDef['extends'] }): GraphType;
}

const registered = new Map<string, GraphType>();

/**
 * Define what kind of map this is: which nodes it offers, which wires are legal and how it runs.
 *
 *   export const pipelines = defineGraphType({
 *     id: 'acme/pipeline', title: 'Pipelines',
 *     extends: [mathGraph], packs: [acmePack], exclude: ['async/*'],
 *   });
 */
export function defineGraphType(def: GraphTypeDef): GraphType {
  const type: GraphType = {
    ...def,
    createRegistry() {
      const reg = new Registry();
      for (const parent of def.extends ?? []) {
        const p = typeof parent === 'string' ? registered.get(parent) : parent;
        if (!p) throw new Error(`Graph type "${def.id}" extends unknown type "${parent}"`);
        reg.merge(p.createRegistry());
      }
      def.portTypes?.forEach((p) => reg.definePortType(p));
      def.paramKinds?.forEach((k) => reg.defineParamKind(k));
      def.packs?.forEach((p) => reg.use(p));
      def.nodes?.forEach((n) => reg.define(n));
      if (def.exclude) reg.remove(...def.exclude);
      reg.rules = { ...reg.rules, ...def.rules };
      if (def.engine) reg.engine = def.engine;
      reg.id = def.id;
      reg.title = def.title;
      def.setup?.(reg);
      return reg;
    },
    extend(child) {
      return defineGraphType({ ...child, extends: [type, ...(child.extends ?? [])] });
    },
  };
  return type;
}

/** Make a graph type available by id (for `<node-map graph-type="…">`, saved JSON and `extends: ['id']`). */
export function registerGraphType(type: GraphType): GraphType {
  registered.set(type.id, type);
  return type;
}

export function getGraphType(id: string): GraphType | undefined {
  return registered.get(id);
}

export function listGraphTypes(): GraphType[] {
  return [...registered.values()];
}

/** The registry for a saved map: from its `type` field, falling back to `fallback`. */
export function registryFor(json: GraphJSON, fallback?: GraphType | string): Registry {
  const t = (json.type && registered.get(json.type)) || (typeof fallback === 'string' ? registered.get(fallback) : fallback);
  if (!t) throw new Error(`Unknown graph type "${json.type ?? fallback}"`);
  return t.createRegistry();
}
