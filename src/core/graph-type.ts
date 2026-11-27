import { Registry, type EditorPlugin, type GraphEngine, type GraphRules, type NodeInput, type NodePack } from './registry.js';
import type { Edge, GraphJSON, NodeInstance, ParamKind, PortTypeDef, WireMarker } from './types.js';
import type { Graph } from './graph.js';

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
  /** Tabs that each show some node types, laid out as a grid, in rows or as a flow. */
  views?: EditorView[];
  /** Editor plugins for maps of this type (packs can contribute their own too). */
  plugins?: EditorPlugin[];
  /** Style one wire (arrows, dash, colour, class, label), on top of its port type's style. */
  edgeStyle?: EdgeStyler;
}

/**
 * How one wire looks, beyond its port type's `wire` style: markers at the output end (`start`)
 * or input end (`end`), `'none'` to remove one, a dash, a colour, a CSS class and a label the
 * editor draws at the wire's middle.
 */
export interface EdgeStyle {
  start?: WireMarker | 'none';
  end?: WireMarker | 'none';
  dash?: boolean | string;
  color?: string;
  className?: string;
  label?: string;
}
export type EdgeStyler = (edge: Edge, graph: Graph) => EdgeStyle | undefined | void;

/**
 * A view's own layout: positions for the cards it shows, given their sizes and the width
 * of the screen in map units.
 */
export type ViewLayout = (
  nodes: { id: string; type: string; w: number; h: number }[],
  ctx: { graph: Graph; width: number },
) => Record<string, { x: number; y: number }>;

/** A box of cards in a grid view (see `EditorView.groups`). */
export interface ViewGroup {
  id: string;
  title: string;
  subtitle?: string;
  /** Card ids in the box, in order. */
  nodes: string[];
  /** Tapping the header opens this node (on its own tab, zoomed to it). */
  open?: string;
  /** The box's colour (e.g. the scene type's). */
  color?: string;
}

/**
 * A tab in the editor: which node types it shows (and its + button adds) and how they are
 * laid out. With views, the map is a set of boards rather than one canvas.
 *
 *   { id: 'cast', title: 'Cast', types: ['drama2/character'], layout: 'grid' }
 */
export interface EditorView {
  id: string;
  title: string;
  /** Node types shown in this view and offered by its + button. */
  types: string[];
  /**
   * 'grid': cards in as many columns as fit the screen. 'rows': one row per group (see
   * `rows`). 'flow' (default): the usual layered layout.
   */
  layout?: 'grid' | 'rows' | 'flow' | ViewLayout;
  /** Rows layout: node ids per row, in order. Nodes left out go in a last row. */
  rows?: (graph: Graph) => string[][];
  /** Grid layout: node ids in order. Default: by `types` order, then as added. */
  order?: (graph: Graph) => string[];
  /**
   * Grid layout in boxes: each group's cards in a box with a header (a scene around its shots).
   * A card in several groups shows in each (a copy after the first, which opens the card).
   * Tapping a header opens `open` (e.g. the scene, on its own tab).
   */
  groups?: (graph: Graph) => ViewGroup[];
  /** After a node is added in this view: link it to what was selected, number it, etc. */
  onAdd?: (node: NodeInstance, ctx: { graph: Graph; selected?: NodeInstance }) => void;
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
