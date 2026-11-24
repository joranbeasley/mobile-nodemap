import { overlaps } from './geometry.js';
import type { Point, Rect } from './types.js';

export interface FreeSpotOptions {
  /** Minimum gap to keep from other nodes. */
  gap?: number;
  /** 'y' only slides up/down (keeps a column); 'both' may also slide sideways. */
  axis?: 'y' | 'both';
}

/**
 * The nearest top-left position to `want` where a box of its size does not overlap `others`.
 * Candidates are the edges of nearby boxes, so the result sits snugly next to them.
 */
export function findFreeSpot(others: Rect[], want: Rect, opts: FreeSpotOptions = {}): Point {
  const gap = opts.gap ?? 24;
  const fits = (x: number, y: number) => !others.some((o) => overlaps({ x, y, w: want.w, h: want.h }, o, gap - 0.5));
  if (fits(want.x, want.y)) return { x: want.x, y: want.y };

  const xs = new Set([want.x]);
  const ys = new Set([want.y]);
  for (const o of others) {
    ys.add(o.y + o.h + gap).add(o.y - want.h - gap);
    if (opts.axis === 'both') xs.add(o.x + o.w + gap).add(o.x - want.w - gap);
  }
  // Sideways moves cost a little more than vertical ones so columns stay tidy.
  const candidates: { x: number; y: number; d: number }[] = [];
  for (const x of xs) for (const y of ys) candidates.push({ x, y, d: Math.abs(x - want.x) * 1.3 + Math.abs(y - want.y) });
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) if (fits(c.x, c.y)) return { x: c.x, y: c.y };
  // Everything around is packed: go below the lowest box.
  const bottom = Math.max(...others.map((o) => o.y + o.h));
  return { x: want.x, y: bottom + gap };
}
