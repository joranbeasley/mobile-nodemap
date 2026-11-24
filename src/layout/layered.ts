import { bounds } from './geometry.js';
import type { LayoutEngine, LayoutInput, LayoutNode, Positions } from './types.js';

export interface LayeredOptions {
  /** Horizontal gap between layers. */
  gapX?: number;
  /** Vertical gap between nodes in a layer. */
  gapY?: number;
  /** Vertical gap between wrapped rows. */
  rowGap?: number;
  /** Crossing-reduction passes. */
  sweeps?: number;
}

/**
 * A dependency-free layered (Sugiyama-style) layout:
 * longest-path layering, barycentre ordering that respects port order, and port-aligned
 * vertical placement so straight wires stay straight. With `maxWidth` it wraps layers into
 * rows, which suits portrait phone screens.
 */
export function layered(opts: LayeredOptions = {}): LayoutEngine {
  const gapX = opts.gapX ?? 80;
  const gapY = opts.gapY ?? 36;
  const rowGap = opts.rowGap ?? 90;
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

    // 3. Columns, wrapped into rows when a max width is given.
    const colW = layers.map((l) => Math.max(...l.map((id) => nodes.get(id)!.w)));
    const rows: number[][] = [[]];
    let cursor = 0;
    const colX: number[] = [];
    layers.forEach((_, L) => {
      const row = rows[rows.length - 1];
      if (input.maxWidth && row.length && cursor + colW[L] > input.maxWidth) {
        rows.push([]);
        cursor = 0;
      }
      rows[rows.length - 1].push(L);
      colX[L] = cursor;
      cursor += colW[L] + gapX;
    });

    // 4. Vertical placement: line ports up with their neighbours, then resolve overlaps.
    const pos: Positions = {};
    const portY = (id: string, port: string, dir: 'in' | 'out') =>
      nodes.get(id)!.ports.find((p) => p.name === port && p.dir === dir)?.y ?? nodes.get(id)!.h / 2;
    const placeColumn = (L: number, target: (id: string) => number | undefined) => {
      let bottom = -Infinity;
      let shift = 0;
      let n = 0;
      const ys = layers[L].map((id) => {
        const t = target(id);
        const y = Math.max(t ?? (bottom === -Infinity ? 0 : bottom + gapY), bottom + gapY);
        bottom = y + nodes.get(id)!.h;
        if (t !== undefined) (shift += t - y), n++;
        return y;
      });
      const s = n ? shift / n : 0;
      layers[L].forEach((id, i) => (pos[id] = { x: colX[L], y: ys[i] + s }));
    };
    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);

    let top = 0;
    for (const row of rows) {
      const inRow = new Set(row);
      const fromPreds = (id: string) =>
        mean(
          preds
            .get(id)!
            .filter((e) => inRow.has(layer.get(e.from.node)!) && pos[e.from.node])
            .map((e) => pos[e.from.node].y + portY(e.from.node, e.from.port, 'out') - portY(id, e.to.port, 'in')),
        );
      const fromSuccs = (id: string) =>
        mean(
          succs
            .get(id)!
            .filter((e) => inRow.has(layer.get(e.to.node)!) && pos[e.to.node])
            .map((e) => pos[e.to.node].y + portY(e.to.node, e.to.port, 'in') - portY(id, e.from.port, 'out')),
        );
      for (const L of row) placeColumn(L, fromPreds);
      for (const L of [...row].reverse().slice(1)) placeColumn(L, (id) => fromPreds(id) ?? fromSuccs(id) ?? pos[id].y);
      for (const L of row.slice(1)) placeColumn(L, (id) => fromPreds(id) ?? pos[id].y);
      // Stack this row below the previous one.
      const ids = row.flatMap((L) => layers[L]);
      const b = bounds(ids.map((id) => ({ ...pos[id], w: nodes.get(id)!.w, h: nodes.get(id)!.h })));
      ids.forEach((id) => (pos[id].y += top - b.y));
      top += b.h + rowGap;
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
