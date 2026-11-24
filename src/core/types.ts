/** A port type name. Built-ins: any, number, string, boolean, list, object. Custom names are allowed. */
export type PortType = string;

export interface PortDef {
  name: string;
  type?: PortType;
  label?: string;
  /** Value used when an input is not connected and has no inline value. */
  default?: unknown;
  /** Show an inline editor on the node when this input is unconnected (default: true for primitive types). */
  inline?: boolean;
}

export type ParamDef =
  | { name: string; label?: string; kind: 'number'; default?: number; min?: number; max?: number; step?: number }
  | { name: string; label?: string; kind: 'text'; default?: string; multiline?: boolean; placeholder?: string }
  | { name: string; label?: string; kind: 'boolean'; default?: boolean }
  | { name: string; label?: string; kind: 'select'; default?: string; options: string[] };

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
  inputs?: PortDef[];
  outputs?: PortDef[];
  params?: ParamDef[];
  run?: RunFn;
  /** Set false for impure nodes (random, clock) so results are never reused from cache. */
  pure?: boolean;
  view?: NodeView;
  /** Dynamic port lists derived from params (e.g. an expression node whose inputs follow its variables). */
  ports?: (params: Record<string, unknown>) => { inputs?: PortDef[]; outputs?: PortDef[] };
}

export interface NodeInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Param values and inline values for unconnected inputs, keyed by name. */
  params: Record<string, unknown>;
  label?: string;
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
