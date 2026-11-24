import { describe, it, expect } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Router, layered, elkLayout, findFreeSpot, overlaps, roundedPath } from '../src/layout';
import type { LayoutInput, Point, Rect } from '../src/layout';

const crosses = (pts: Point[], r: Rect) =>
  pts.slice(1).some((b, i) => {
    const a = pts[i];
    // sample along the segment
    for (let t = 0.05; t < 1; t += 0.05) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    }
    return false;
  });

describe('Router', () => {
  it('routes around a node in the way, orthogonally', () => {
    const src = { x: 0, y: 0, w: 100, h: 60 };
    const dst = { x: 400, y: 0, w: 100, h: 60 };
    const wall = { x: 200, y: -50, w: 100, h: 160 };
    const r = new Router([src, dst, wall]);
    const pts = r.route({ x: 100, y: 30 }, { x: 400, y: 30 })!;
    expect(pts).not.toBeNull();
    expect(crosses(pts, wall)).toBe(false);
    pts.slice(1).forEach((p, i) => expect(p.x === pts[i].x || p.y === pts[i].y).toBe(true));
    expect(pts[0]).toEqual({ x: 100, y: 30 });
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 30 });
    expect(roundedPath(pts)).toMatch(/^M100,30 /);
  });

  it('draws a straight wire when nothing is in the way', () => {
    const r = new Router([{ x: 0, y: 0, w: 100, h: 60 }, { x: 300, y: 0, w: 100, h: 60 }]);
    expect(r.route({ x: 100, y: 30 }, { x: 300, y: 30 })).toEqual([{ x: 100, y: 30 }, { x: 300, y: 30 }]);
  });

  it('loops back around for a wire going right-to-left', () => {
    const a = { x: 300, y: 0, w: 100, h: 60 };
    const b = { x: 0, y: 0, w: 100, h: 60 };
    const pts = new Router([a, b]).route({ x: 400, y: 30 }, { x: 0, y: 30 })!;
    expect(crosses(pts, a) || crosses(pts, b)).toBe(false);
  });
});

const chain = (n: number): LayoutInput => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `n${i}`, x: (i * 37) % 100, y: (i * 53) % 90, w: 180, h: 80,
    ports: [{ name: 'in', dir: 'in' as const, x: 0, y: 40 }, { name: 'out', dir: 'out' as const, x: 180, y: 40 }],
  })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, from: { node: `n${i}`, port: 'out' }, to: { node: `n${i + 1}`, port: 'in' } })),
});

const noOverlaps = (input: LayoutInput, pos: Record<string, Point>) => {
  const rects = input.nodes.map((n) => ({ ...pos[n.id], w: n.w, h: n.h }));
  rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
};

describe('layered layout', () => {
  it('puts a chain in one straight row', () => {
    const input = chain(4);
    const pos = layered()(input) as Record<string, Point>;
    noOverlaps(input, pos);
    expect(new Set(Object.values(pos).map((p) => p.y)).size).toBe(1);
    expect(pos.n0.x).toBeLessThan(pos.n1.x);
  });

  it('wraps into rows under maxWidth', () => {
    const input = { ...chain(6), maxWidth: 500 };
    const pos = layered()(input) as Record<string, Point>;
    noOverlaps(input, pos);
    const right = Math.max(...Object.values(pos).map((p) => p.x)) + 180 - Math.min(...Object.values(pos).map((p) => p.x));
    expect(right).toBeLessThanOrEqual(500);
    expect(new Set(Object.values(pos).map((p) => p.y)).size).toBe(3);
  });

  it('separates siblings that share a layer', () => {
    const input = chain(2);
    input.nodes.push({ ...input.nodes[1], id: 'n2', y: 0 });
    input.edges.push({ id: 'x', from: { node: 'n0', port: 'out' }, to: { node: 'n2', port: 'in' } });
    noOverlaps(input, layered()(input) as Record<string, Point>);
  });
});

describe('elkLayout', () => {
  it('lays out with elkjs', async () => {
    const input = chain(4);
    const pos = await elkLayout(new ELK())(input);
    noOverlaps(input, pos);
    expect(pos.n0.x).toBeLessThan(pos.n3.x);
  });
});

describe('findFreeSpot', () => {
  it('slides a box out of the way of existing boxes', () => {
    const others = [{ x: 0, y: 0, w: 100, h: 100 }];
    const p = findFreeSpot(others, { x: 10, y: 10, w: 100, h: 50 });
    expect(overlaps({ ...p, w: 100, h: 50 }, others[0])).toBe(false);
    expect(p.x).toBe(10);
  });
});

describe('Router precision', () => {
  it('routes between fractional port positions', () => {
    const r = new Router([{ x: 0, y: 0, w: 178, h: 121 }, { x: 230, y: -20, w: 178, h: 121 }, { x: 500, y: 0, w: 178, h: 81 }]);
    const pts = r.route({ x: 177.0001, y: 96.890625 }, { x: 501.0003, y: 56.890617 });
    expect(pts).not.toBeNull();
    expect(crosses(pts!, { x: 230, y: -20, w: 178, h: 121 })).toBe(false);
  });
});

describe('Flow direction', () => {
  const tbChain = (n: number): LayoutInput => ({
    direction: 'TB',
    nodes: Array.from({ length: n }, (_, i) => ({
      id: `n${i}`, x: (i * 37) % 100, y: (i * 53) % 90, w: 180, h: 80,
      // Top-to-bottom: input on the top edge, output on the bottom edge.
      ports: [{ name: 'in', dir: 'in' as const, x: 90, y: 0 }, { name: 'out', dir: 'out' as const, x: 90, y: 80 }],
    })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, from: { node: `n${i}`, port: 'out' }, to: { node: `n${i + 1}`, port: 'in' } })),
  });

  it('top to bottom: one straight column, roomy gaps', () => {
    const input = tbChain(4);
    const pos = layered()(input) as Record<string, Point>;
    noOverlaps(input, pos);
    expect(new Set(Object.values(pos).map((p) => p.x)).size).toBe(1);
    expect(pos.n1.y - pos.n0.y).toBeGreaterThanOrEqual(80 + 100);
  });

  it('top to bottom: siblings sit side by side in one row', () => {
    const input = tbChain(2);
    input.nodes.push({ ...input.nodes[1], id: 'n2' });
    input.edges.push({ id: 'x', from: { node: 'n0', port: 'out' }, to: { node: 'n2', port: 'in' } });
    const pos = layered()(input) as Record<string, Point>;
    noOverlaps(input, pos);
    expect(pos.n1.y).toBe(pos.n2.y);
    expect(Math.abs(pos.n1.x - pos.n2.x)).toBeGreaterThanOrEqual(180 + 40);
  });

  it('never wraps unless asked', () => {
    const input = chain(8);
    const pos = layered()(input) as Record<string, Point>;
    expect(new Set(Object.values(pos).map((p) => p.y)).size).toBe(1);
  });

  it('routes downward wires around a node in the way', () => {
    const top = { x: 0, y: 0, w: 180, h: 80 };
    const wall = { x: -40, y: 150, w: 260, h: 80 };
    const bottom = { x: 0, y: 320, w: 180, h: 80 };
    const pts = new Router([top, wall, bottom]).route({ x: 90, y: 80 }, { x: 90, y: 320 }, '', 'TB')!;
    expect(pts).not.toBeNull();
    expect(crosses(pts, wall)).toBe(false);
    expect(pts[1].y).toBeGreaterThan(pts[0].y);                   // leaves downward
    expect(pts[pts.length - 2].y).toBeLessThan(pts[pts.length - 1].y); // arrives from above
  });

  it('elk lays out top to bottom', async () => {
    const input = tbChain(3);
    const pos = await elkLayout(new ELK())(input);
    expect(pos.n0.y).toBeLessThan(pos.n1.y);
    expect(pos.n1.y).toBeLessThan(pos.n2.y);
  });
});
