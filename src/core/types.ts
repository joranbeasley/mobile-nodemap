/** A port type id. Built-ins: any, number, string, boolean, list. Packs add their own (see PortTypeDef). */
export type PortType = string;

export interface PortDef {
  name: string;
  type?: PortType;
  label?: string;
  description?: string;
  /** Value used when an input is not connected and has no inline value. */
  default?: unknown;
  /** Show an inline editor on the node when this input is unconnected (default: true for primitive types). */
  inline?: boolean;
  /**
   * Inputs: accept any number of wires; the run function receives an array of values (top to bottom).
   * Outputs always fan out, so this only matters for inputs.
   */
  multiple?: boolean;
}

/**
 * A port type contributed by a pack: how it looks, what it connects to and how it is edited.
 *
 *   { id: 'color', color: '#e64980', accepts: ['string'], inline: 'color', coerce: (v) => String(v) }
 */
export interface PortTypeDef {
  id: PortType;
  label?: string;
  /** Wire and port colour (any CSS colour). */
  color?: string;
  /** Other port types whose values may flow into this one. */
  accepts?: PortType[];
  /** Convert an incoming value (from an accepted type) into this type. */
  coerce?: (value: unknown) => unknown;
  /** Inline editor for unconnected inputs: a built-in kind ('number' | 'text' | 'boolean') or a param kind id. */
  inline?: string | false;
  /** Value used when nothing is connected and no default is given. */
  default?: unknown;
  /**
   * How wires of this type look: dashed, and markers at the output end (`start`) or the input
   * end (`end`). UML uses it for hollow triangles, diamonds and open arrows.
   */
  wire?: WireStyle;
}

export type WireMarker = 'arrow' | 'triangle' | 'triangle-filled' | 'diamond' | 'diamond-filled' | 'circle';

export interface WireStyle {
  /** true for a standard dash, or an SVG dash array such as '2 4'. */
  dash?: boolean | string;
  /** Marker at the output end of the wire. */
  start?: WireMarker;
  /** Marker at the input end of the wire. */
  end?: WireMarker;
}

interface ParamBase {
  name: string;
  label?: string;
  description?: string;
  /** Tuck this param behind the node's "More" toggle to keep nodes small on phones. */
  advanced?: boolean;
  /**
   * Whether it's on the node's card. `false`: edited in the Edit sheet only (keeps cards small);
   * a function: on the card only when it says so (e.g. once there's something to see). Default true.
   */
  card?: boolean | ((params: Record<string, unknown>) => boolean);
  /**
   * Show this param only when it applies, given the node's params. Hidden params keep their
   * value. `when: (p) => p.kind === 'Outfit'`
   */
  when?: (params: Record<string, unknown>) => boolean;
}

export type BuiltinParamDef =
  | (ParamBase & { kind: 'number'; default?: number; min?: number; max?: number; step?: number })
  | (ParamBase & { kind: 'text'; default?: string; multiline?: boolean; placeholder?: string; code?: boolean })
  | (ParamBase & { kind: 'boolean'; default?: boolean })
  | (ParamBase & { kind: 'select'; default?: string; options: string[] });

/** A param whose editor comes from a registered ParamKind (e.g. 'color', 'slider2d', 'file'). */
export interface CustomParamDef extends ParamBase {
  kind: string;
  default?: unknown;
  /** Anything the param kind wants (options, ranges, …). */
  [option: string]: unknown;
}

export type ParamDef = BuiltinParamDef | CustomParamDef;

/** Context a ParamKind gets to build its control. */
export interface ParamControlContext {
  param: ParamDef;
  node: NodeInstance;
  /** The map the node is in (for controls that refer to other nodes). */
  graph: import('./graph.js').Graph;
  value: unknown;
  /** Commit a new value (updates the graph and re-runs). */
  set(value: unknown): void;
  /** Stable key: put it in a `data-key` attribute on the focusable element to keep focus across re-renders. */
  key: string;
  /**
   * Ask the person to pick one item from a searchable sheet (given by the editor). Resolves
   * with the picked id, or undefined if they close it. Use it when a plain select gets long.
   */
  choose?: (opts: ChooseOptions) => Promise<string | undefined>;
  /** Where the control is: on the node's card (on the canvas) or in its Edit sheet. */
  place?: 'card' | 'sheet';
}

export interface ChooseOptions {
  title: string;
  placeholder?: string;
  items: { id: string; label: string; hint?: string; /** A preview image. */ image?: string }[];
}

/** A custom editor for params (and inline port values): `registry.defineParamKind({ kind: 'color', render })`. */
export interface ParamKind {
  kind: string;
  render(ctx: ParamControlContext): HTMLElement;
  /** Update an existing control after an outside change (undo, API). Optional. */
  update?(el: HTMLElement, value: unknown): void;
}

export interface RunContext {
  node: NodeInstance;
  params: Record<string, unknown>;
  /** External graph inputs passed to `evaluate()` (read by the `graph/input` node). */
  graphInputs: Record<string, unknown>;
  signal: AbortSignal;
}

export type RunFn = (
  inputs: Record<string, any>,
  ctx: RunContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface NodeView {
  /** Render a custom preview (chart, swatch, text) into `el` after the node evaluates. */
  render(el: HTMLElement, result: NodeResult | undefined, node: NodeInstance): void;
}

export interface NodeType {
  type: string;
  title?: string;
  category?: string;
  description?: string;
  /** Accent color for the node header (any CSS color). */
  color?: string;
  /**
   * The node's role, which themes style: 'source' | 'transform' | 'sink' | 'view' | 'control',
   * or a pack's own. Inferred from the ports when left out.
   */
  flavor?: string;
  /**
   * Header title for nodes without a name, worked out from their params:
   *   caption: (n) => `Shot ${n.params.number}`
   */
  caption?: (node: NodeInstance) => string;
  /**
   * `false`: its card is for looking only (fields don't respond, links don't jump); its ✎ Edit
   * button (shown zoomed in) or a double tap opens its Edit sheet. Elements marked `data-nm-live` (a play button) still work.
   */
  editOnCard?: boolean;
  /** On a look-only card: the label of the button that shows its `details` (they don't show on tap). Default "Details". */
  detailsLabel?: string;
  /** …and its icon (default ⓘ). */
  detailsIcon?: string;
  /** Short text, an emoji or an inline `<svg>` shown in the header and the add menu. */
  icon?: string;
  /** Extra search words for the add menu. */
  tags?: string[];
  /** Link to documentation for this node. */
  docs?: string;
  /** Fixed node width in px (default: fits content, 176–250). */
  width?: number;
  inputs?: PortDef[];
  outputs?: PortDef[];
  params?: ParamDef[];
  run?: RunFn;
  /**
   * Inline this node when a map is exported as source code (emitSource). Receives a JS
   * expression for each input and returns a JS expression for each output. Nodes without it
   * are called through a NodeRunner in the generated code.
   *   emit: ({ a, b }) => ({ out: `(${a}) + (${b})` })
   */
  emit?: (inputs: Record<string, string>, params: Record<string, unknown>) => Record<string, string>;
  /**
   * What the editor shows when someone taps this node: a title, text, code and actions.
   * Custom nodes use it to show their JavaScript and an "Edit in graph" action.
   */
  details?: (node: NodeInstance, ctx: NodeDetailsContext) => NodeDetails;
  /**
   * A node that is itself a node map. The editor shows an "open" button on it; opening shows
   * the map inside, running on this node's live inputs, and, with `save`, edits there change
   * this node type. `graphNode()` and library nodes set it.
   */
  subgraph?: (node: NodeInstance) => NodeSubgraph | undefined;
  /** Set false for impure nodes (random, clock) so results are never reused from cache. */
  pure?: boolean;
  view?: NodeView;
  /** Dynamic port lists derived from params (e.g. an expression node whose inputs follow its variables). */
  ports?: (params: Record<string, unknown>) => { inputs?: PortDef[]; outputs?: PortDef[] };
  /** Called once when a node of this type is added (not on load). Return params to merge in. */
  onCreate?: (node: NodeInstance) => Record<string, unknown> | void;
  /** Schema version of this node's params. Bump it and add `migrate` when params change shape. */
  version?: number;
  /** Upgrade params saved by an older version when a graph loads. */
  migrate?: (params: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
  /** Free-form data for engines and tools (e.g. a network role). */
  meta?: Record<string, unknown>;
}

/** The map inside a node (see NodeType.subgraph). */
export interface NodeSubgraph {
  graph: GraphJSON;
  /** The registry the inner map's nodes come from. */
  registry: import('./registry.js').Registry;
  title?: string;
  /** Keep edits made inside: called with the edited map. Without it, the map opens read-only in spirit (edits are dropped on the way out). */
  save?: (graph: GraphJSON) => void;
}

/** What `details()` can look at: the map around the node and its latest result. */
export interface NodeDetailsContext {
  graph: import('./graph.js').Graph;
  result?: NodeResult;
}

/** A card about a node: shown by the editor when the node is tapped. */
export interface NodeDetails {
  title: string;
  subtitle?: string;
  /** Source code to show (with a Copy button). */
  code?: { lang: string; text: string };
  actions?: { label: string; primary?: boolean; run(): void }[];
}

export interface NodeInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Param values and inline values for unconnected inputs, keyed by name. */
  params: Record<string, unknown>;
  label?: string;
  /** The node type's `version` when these params were written. */
  v?: number;
}

export interface PortRef {
  node: string;
  port: string;
}

export interface Edge {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface GraphJSON {
  version: 1;
  /** Id of the graph type this map was made with (see defineGraphType). */
  type?: string;
  nodes: NodeInstance[];
  edges: Edge[];
  meta?: Record<string, unknown>;
}

export interface NodeResult {
  status: 'ok' | 'error' | 'running' | 'skipped';
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}
