import { bounds } from './geometry.js';
import type { LayoutEngine, LayoutInput, LayoutNode, Positions } from './types.js';

export interface LayeredOptions {
  /** Space between layers, along the flow. Default 120. */
  layerGap?: number;
  /** Space between nodes in the same layer. Default 56. */
  nodeGap?: number;
  /** Space between wrapped bands (only with `maxWidth`). Default 100. */
  bandGap?: number;
  /** Crossing-reduction passes. */
  sweeps?: number;
  /** @deprecated Use layerGap. */
  gapX?: number;
  /** @deprecated Use nodeGap. */
  gapY?: number;
  /** @deprecated Use bandGap. */
  rowGap?: number;
}

/**
 * A dependency-free layered (Sugiyama-style) layout:
 * longest-path layering, barycentre ordering that respects port order, and port-aligned
 * placement so straight wires stay straight. It flows left to right (`direction: 'LR'`) or
 * top to bottom (`'TB'`) as one uncrowded flow. Wrapping into bands is opt-in: pass `maxWidth`
 * with left-to-right flow.
 */
export function layered(opts: LayeredOptions = {}): LayoutEngine {
  // Roomy by default: a readable map beats a compact one.
  const layerGap = opts.layerGap ?? opts.gapX ?? 120;
  const nodeGap = opts.nodeGap ?? opts.gapY ?? 56;
  const bandGap = opts.bandGap ?? opts.rowGap ?? 100;
  const sweeps = opts.sweeps ?? 8;

  return (input: LayoutInput): Positions => {
    const nodes = new Map(input.nodes.map((n) => [n.id, n]));
    if (!nodes.size) return {};
    const all = input.edges.filter((e) => nodes.has(e.from.node) && nodes.has(e.to.node) && e.from.node !== e.to.node);
    const edges = withoutBackEdges([...nodes.keys()], all);
    const preds = new Map<string, typeof edges>();
    const succs = new Map<string, typeof edges>();
    for (const id of nodes.keys()) preds.set(id, []), succs.set(id, []);
    for (const e of edges) {
      preds.get(e.to.node)!.push(e);
      succs.get(e.from.node)!.push(e);
    }

    // 1. Layering: longest path from the sources.
    const layer = new Map<string, number>();
    const indeg = new Map([...nodes.keys()].map((id) => [id, preds.get(id)!.length]));
    const queue = [...nodes.keys()].filter((id) => indeg.get(id) === 0);
    const topo: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      topo.push(id);
      layer.set(id, Math.max(0, ...preds.get(id)!.map((e) => (layer.get(e.from.node) ?? 0) + 1)));
      for (const e of succs.get(id)!) {
        indeg.set(e.to.node, indeg.get(e.to.node)! - 1);
        if (indeg.get(e.to.node) === 0) queue.push(e.to.node);
      }
    }
    for (const id of nodes.keys()) if (!layer.has(id)) layer.set(id, 0), topo.push(id);
    // Pull sources right, next to their first consumer, so inputs sit beside what uses them.
    for (const id of [...topo].reverse()) {
      if (preds.get(id)!.length || !succs.get(id)!.length) continue;
      layer.set(id, Math.min(...succs.get(id)!.map((e) => layer.get(e.to.node)!)) - 1);
    }

    // Renumber so there are no empty layers.
    const used = [...new Set(layer.values())].sort((a, b) => a - b);
    for (const [id, L] of layer) layer.set(id, used.indexOf(L));
    const count = used.length;
    const layers: string[][] = Array.from({ length: count }, () => []);
    for (const id of nodes.keys()) layers[layer.get(id)!].push(id);
    layers.forEach((l) => l.sort((a, b) => nodes.get(a)!.y - nodes.get(b)!.y));

    // 2. Ordering: barycentre sweeps using port positions.
    const portFrac = (n: LayoutNode, port: string, dir: 'in' | 'out') => {
      const ps = n.ports.filter((p) => p.dir === dir).sort((a, b) => a.y - b.y);
      const i = ps.findIndex((p) => p.name === port);
      return ps.length > 1 ? (i / (ps.length - 1) - 0.5) * 0.6 : 0;
    };
    const order = new Map<string, number>();
    const index = () => layers.forEach((l) => l.forEach((id, i) => order.set(id, i)));
    index();
    for (let s = 0; s < sweeps; s++) {
      const down = s % 2 === 0;
      const range = down ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
      for (const L of range) {
        const bary = new Map<string, number>();
        for (const id of layers[L]) {
          const es = down ? preds.get(id)! : succs.get(id)!;
          const vals = es
            .filter((e) => layer.get(down ? e.from.node : e.to.node) === L + (down ? -1 : 1))
            .map((e) =>
              down
                ? order.get(e.from.node)! + portFrac(nodes.get(e.from.node)!, e.from.port, 'out') - portFrac(nodes.get(id)!, e.to.port, 'in')
                : order.get(e.to.node)! + portFrac(nodes.get(e.to.node)!, e.to.port, 'in') - portFrac(nodes.get(id)!, e.from.port, 'out'),
            );
          bary.set(id, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : order.get(id)!);
        }
        layers[L].sort((a, b) => bary.get(a)! - bary.get(b)! || order.get(a)! - order.get(b)!);
        layers[L].forEach((id, i) => order.set(id, i));
      }
    }

    // 3. Layers along the flow: columns (left to right) or rows (top to bottom).
    //    "main" is the flow axis, "cross" the axis within a layer.
    const tb = input.direction === 'TB';
    const mainSize = (n: LayoutNode) => (tb ? n.h : n.w);
    const crossSize = (n: LayoutNode) => (tb ? n.w : n.h);
    const layerSize = layers.map((l) => Math.max(...l.map((id) => mainSize(nodes.get(id)!))));
    // Wrapping is opt-in (left to right with maxWidth only); by default a map is one long flow.
    const bands: number[][] = [[]];
    let cursor = 0;
    const layerAt: number[] = [];
    layers.forEach((_, L) => {
      const band = bands[bands.length - 1];
      if (!tb && input.maxWidth && band.length && cursor + layerSize[L] > input.maxWidth) {
        bands.push([]);
        cursor = 0;
      }
      bands[bands.length - 1].push(L);
      layerAt[L] = cursor;
      cursor += layerSize[L] + layerGap;
    });

    // 4. Placement within each layer: line ports up with their neighbours, then resolve overlaps.
    const crossPos = new Map<string, number>();
    const portCross = (id: string, port: string, dir: 'in' | 'out') => {
      const n = nodes.get(id)!;
      const p = n.ports.find((q) => q.name === port && q.dir === dir);
      return p ? (tb ? p.x : p.y) : crossSize(n) / 2;
    };
    const placeLayer = (L: number, target: (id: string) => number | undefined) => {
      let end = -Infinity;
      let shift = 0;
      let n = 0;
      const cs = layers[L].map((id) => {
        const t = target(id);
        const c = Math.max(t ?? (end === -Infinity ? 0 : end + nodeGap), end + nodeGap);
        end = c + crossSize(nodes.get(id)!);
        if (t !== undefined) (shift += t - c), n++;
        return c;
      });
      const s = n ? shift / n : 0;
      layers[L].forEach((id, i) => crossPos.set(id, cs[i] + s));
    };
    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);

    const pos: Positions = {};
    let bandTop = 0;
    for (const band of bands) {
      const inBand = new Set(band);
      const fromPreds = (id: string) =>
        mean(
          preds
            .get(id)!
            .filter((e) => inBand.has(layer.get(e.from.node)!) && crossPos.has(e.from.node))
            .map((e) => crossPos.get(e.from.node)! + portCross(e.from.node, e.from.port, 'out') - portCross(id, e.to.port, 'in')),
        );
      const fromSuccs = (id: string) =>
        mean(
          succs
            .get(id)!
            .filter((e) => inBand.has(layer.get(e.to.node)!) && crossPos.has(e.to.node))
            .map((e) => crossPos.get(e.to.node)! + portCross(e.to.node, e.to.port, 'in') - portCross(id, e.from.port, 'out')),
        );
      for (const L of band) placeLayer(L, fromPreds);
      for (const L of [...band].reverse().slice(1)) placeLayer(L, (id) => fromPreds(id) ?? fromSuccs(id) ?? crossPos.get(id));
      for (const L of band.slice(1)) placeLayer(L, (id) => fromPreds(id) ?? crossPos.get(id));
      // Wrapped bands (left to right only) stack below one another.
      const ids = band.flatMap((L) => layers[L]);
      const lo = Math.min(...ids.map((id) => crossPos.get(id)!));
      const hi = Math.max(...ids.map((id) => crossPos.get(id)! + crossSize(nodes.get(id)!)));
      for (const id of ids) {
        const m = layerAt[layer.get(id)!];
        const c = crossPos.get(id)! - lo + bandTop;
        pos[id] = tb ? { x: c, y: m } : { x: m, y: c };
      }
      bandTop += hi - lo + bandGap;
    }

    // Keep the drawing where it was instead of jumping to the origin.
    const before = bounds(input.nodes);
    const after = bounds(input.nodes.map((n) => ({ ...pos[n.id], w: n.w, h: n.h })));
    for (const id of Object.keys(pos)) {
      pos[id] = { x: Math.round(pos[id].x - after.x + before.x), y: Math.round(pos[id].y - after.y + before.y) };
    }
    return pos;
  };
}

/** Drop the edges that close loops (found by depth-first search) so the rest can be layered. */
function withoutBackEdges<E extends { from: { node: string }; to: { node: string } }>(ids: string[], edges: E[]): E[] {
  const out = new Map<string, E[]>(ids.map((id) => [id, []]));
  const hasIn = new Set(edges.map((e) => e.to.node));
  edges.forEach((e) => out.get(e.from.node)!.push(e));
  const state = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = done
  const back = new Set<E>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id)!) {
      const s = state.get(e.to.node);
      if (s === 1) back.add(e);
      else if (!s) visit(e.to.node);
    }
    state.set(id, 2);
  };
  // Start from sources so the natural direction wins; then cover what is left (pure loops).
  for (const id of ids) if (!hasIn.has(id) && !state.has(id)) visit(id);
  for (const id of ids) if (!state.has(id)) visit(id);
  return edges.filter((e) => !back.has(e));
}
