import { inflate, inside, simplify } from './geometry.js';
import type { Point, Rect } from './types.js';

export interface RouterOptions {
  /** Clearance kept around every node. */
  margin?: number;
  /** Straight run out of an output / into an input before the first bend. */
  stub?: number;
  /** Extra cost per bend, in world units. Higher = fewer, longer detours. */
  bendCost?: number;
  /** Extra cost for running along a segment another wire already uses. */
  shareCost?: number;
}

// Directions: 0 right, 1 down, 2 left, 3 up.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Orthogonal wire router that avoids nodes.
 *
 * It searches a sparse grid made from node edges (plus clearance), the channels between
 * them and the wire's own end points, with A* over (point, heading) states. Bends cost
 * extra, and segments already taken by wires from a different output cost extra, so
 * parallel wires spread into separate channels instead of drawing on top of each other.
 */
export class Router {
  readonly margin: number;
  readonly stub: number;
  private bendCost: number;
  private shareCost: number;
  private rects: Rect[];
  private baseX: number[];
  private baseY: number[];
  private used = new Map<string, string>();

  constructor(obstacles: Rect[], opts: RouterOptions = {}) {
    this.margin = opts.margin ?? 14;
    this.stub = opts.stub ?? Math.max(22, this.margin + 8);
    this.bendCost = opts.bendCost ?? 28;
    this.shareCost = opts.shareCost ?? 30;
    this.rects = obstacles.map((r) => inflate(r, this.margin));
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const r of this.rects) {
      xs.add(r.x).add(r.x + r.w);
      ys.add(r.y).add(r.y + r.h);
    }
    if (this.rects.length) {
      const pad = 40;
      xs.add(Math.min(...this.rects.map((r) => r.x)) - pad).add(Math.max(...this.rects.map((r) => r.x + r.w)) + pad);
      ys.add(Math.min(...this.rects.map((r) => r.y)) - pad).add(Math.max(...this.rects.map((r) => r.y + r.h)) + pad);
    }
    this.baseX = withMidpoints([...xs]);
    this.baseY = withMidpoints([...ys]);
  }

  /**
   * Route from an output port at `from` (leaving rightwards) to an input port at `to`
   * (entering from the left). Returns the corner points, or null if no route exists.
   * Pass `owner` (e.g. the source port id) to let wires from the same output share a trunk.
   */
  route(from: Point, to: Point, owner = ''): Point[] | null {
    // Snap to the grid's precision so the end points can be found in it.
    from = { x: snap(from.x), y: snap(from.y) };
    to = { x: snap(to.x), y: snap(to.y) };
    const s = { x: snap(from.x + this.stub), y: from.y };
    const t = { x: snap(to.x - this.stub), y: to.y };
    // A port pressed against a neighbour can put its stub inside that neighbour's clearance; ignore such rects.
    const rects = this.rects.filter((r) => !inside(s, r) && !inside(t, r));
    const xs = sortedUnique([...this.baseX, s.x, t.x]);
    const ys = sortedUnique([...this.baseY, s.y, t.y]);
    const W = xs.length;
    const H = ys.length;
    const free = new Uint8Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) free[j * W + i] = rects.some((r) => inside({ x: xs[i], y: ys[j] }, r)) ? 0 : 1;
    // Can we move from (i,j) one step in direction d? The segment's midpoint must be clear too.
    const step = (i: number, j: number, d: number): boolean => {
      const ni = i + DX[d];
      const nj = j + DY[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || !free[nj * W + ni]) return false;
      const mid = { x: (xs[i] + xs[ni]) / 2, y: (ys[j] + ys[nj]) / 2 };
      return !rects.some((r) => inside(mid, r));
    };

    const si = xs.indexOf(s.x);
    const sj = ys.indexOf(s.y);
    const ti = xs.indexOf(t.x);
    const tj = ys.indexOf(t.y);
    const key = (i: number, j: number, d: number) => (j * W + i) * 4 + d;
    const g = new Float64Array(W * H * 4).fill(Infinity);
    const prev = new Int32Array(W * H * 4).fill(-1);
    const heap = new MinHeap();
    const hcost = (i: number, j: number) => Math.abs(xs[i] - t.x) + Math.abs(ys[j] - t.y);
    const start = key(si, sj, 0);
    g[start] = 0;
    heap.push(start, hcost(si, sj));
    let goal = -1;
    let goalCost = Infinity;

    while (heap.size) {
      const [k, f] = heap.pop();
      if (f >= goalCost) break;
      const d = k & 3;
      const cell = k >> 2;
      const i = cell % W;
      const j = (cell - i) / W;
      if (f > g[k] + hcost(i, j) + 1e-6) continue; // stale heap entry
      if (i === ti && j === tj) {
        // Arriving heading right enters the port cleanly; anything else needs one more turn.
        const total = g[k] + (d === 0 ? 0 : this.bendCost * (d === 2 ? 2 : 1));
        if (total < goalCost) {
          goalCost = total;
          goal = k;
        }
        continue;
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4 || !step(i, j, nd)) continue;
        const ni = i + DX[nd];
        const nj = j + DY[nd];
        const len = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
        const owner2 = this.used.get(segKey(xs[i], ys[j], xs[ni], ys[nj]));
        const share = owner2 !== undefined && owner2 !== owner ? this.shareCost + len * 0.5 : 0;
        const cost = g[k] + len + (nd === d ? 0 : this.bendCost) + share;
        const nk = key(ni, nj, nd);
        if (cost < g[nk]) {
          g[nk] = cost;
          prev[nk] = k;
          heap.push(nk, cost + hcost(ni, nj));
        }
      }
    }
    if (goal < 0) return null;

    const pts: Point[] = [];
    for (let k = goal; k >= 0; k = prev[k]) {
      const cell = k >> 2;
      const i = cell % W;
      pts.push({ x: xs[i], y: ys[(cell - i) / W] });
    }
    pts.reverse();
    const path = simplify([from, ...pts, to]);
    for (let n = 1; n < pts.length; n++) {
      this.used.set(segKey(pts[n - 1].x, pts[n - 1].y, pts[n].x, pts[n].y), owner);
    }
    return path;
  }
}

function segKey(x1: number, y1: number, x2: number, y2: number): string {
  return x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
}

const snap = (n: number) => Math.round(n * 10) / 10;

function sortedUnique(v: number[]): number[] {
  return [...new Set(v.map(snap))].sort((a, b) => a - b);
}

/** Add the midpoint of every gap so wires can run down the middle of channels. */
function withMidpoints(v: number[]): number[] {
  const s = sortedUnique(v);
  const out = [...s];
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > 8) out.push((s[i] + s[i - 1]) / 2);
  return sortedUnique(out);
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, pri: number) {
    const k = this.k;
    const p = this.p;
    let i = k.length;
    k.push(key);
    p.push(pri);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= pri) break;
      k[i] = k[parent];
      p[i] = p[parent];
      i = parent;
    }
    k[i] = key;
    p[i] = pri;
  }
  pop(): [number, number] {
    const k = this.k;
    const p = this.p;
    const top: [number, number] = [k[0], p[0]];
    const lk = k.pop()!;
    const lp = p.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mp = lp;
        if (l < k.length && p[l] < mp) (m = l), (mp = p[l]);
        if (r < k.length && p[r] < mp) m = r;
        if (m === i) break;
        k[i] = k[m];
        p[i] = p[m];
        i = m;
      }
      k[i] = lk;
      p[i] = lp;
    }
    return top;
  }
}
