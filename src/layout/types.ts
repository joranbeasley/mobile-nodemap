export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPort {
  name: string;
  dir: 'in' | 'out';
  /** Port centre relative to the node's top-left corner. */
  x: number;
  y: number;
}

export interface LayoutNode extends Rect {
  id: string;
  ports: LayoutPort[];
}

export interface LayoutEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface LayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** Which way the map flows: left to right (default) or top to bottom. */
  direction?: 'LR' | 'TB';
  /**
   * Opt-in: wrap a left-to-right flow into bands no wider than this (world units).
   * The editor does not use it; it prefers one uncrowded flow.
   */
  maxWidth?: number;
}

export type Positions = Record<string, Point>;

/** A layout engine computes new top-left positions for nodes. */
export type LayoutEngine = (input: LayoutInput) => Positions | Promise<Positions>;
