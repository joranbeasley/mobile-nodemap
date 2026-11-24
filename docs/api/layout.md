# Layout

`import { layered, elkLayout, Router, findFreeSpot } from 'mobile-nodemap/layout'`

No DOM. Usable without the editor.

## Types

```ts
type LayoutEngine = (input: LayoutInput) => Positions | Promise<Positions>;
interface LayoutInput { nodes: LayoutNode[]; edges: LayoutEdge[]; maxWidth?: number }
interface LayoutNode { id: string; x: number; y: number; w: number; h: number; ports: { name: string; dir: 'in' | 'out'; x: number; y: number }[] }
interface LayoutEdge { id: string; from: PortRef; to: PortRef }
type Positions = Record<string, { x: number; y: number }>;
```

## `layered(options?): LayoutEngine`

A Sugiyama-style layout:

- longest-path layering, with loops broken by depth-first search;
- barycentre ordering that respects port order;
- port-aligned vertical placement;
- with `maxWidth`, columns wrap into rows.

| Option | Default |
| --- | --- |
| `gapX` | 80 |
| `gapY` | 36 |
| `rowGap` | 90 |
| `sweeps` | 8 |

The result keeps the drawing's top-left where it was.

## `elkLayout(elk, { options? }): LayoutEngine`

The Eclipse Layout Kernel, with fixed port positions. Pass your own instance: `elkLayout(new ELK())`. `maxWidth` turns on ELK's row wrapping.

## `Router`

Orthogonal wires that avoid nodes.

```ts
const router = new Router(rects: Rect[], { margin?: 14, stub?: 22, bendCost?: 28, shareCost?: 30 });
router.route(fromOutputPoint, toInputPoint, owner?): Point[] | null;
```

`owner` (for example the source port's id) lets wires from the same output share a trunk; others avoid shared segments. Turn the points into a path with `roundedPath(points, radius?)`.

## `findFreeSpot(others, want, { gap?: 24, axis?: 'y' | 'both' }): Point`

The nearest top-left position where a box of `want`'s size does not overlap `others`.

## Geometry helpers

`overlaps(a, b, gap?)`, `bounds(rects)`, `simplify(points)`, `roundedPath(points, r?)`, `bezierPath(a, b)`.
