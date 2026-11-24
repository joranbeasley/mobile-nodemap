# Layout

`import { layered, elkLayout, Router, findFreeSpot } from 'mobile-nodemap/layout'`

No DOM. Usable without the editor.

## Types

```ts
type LayoutEngine = (input: LayoutInput) => Positions | Promise<Positions>;
interface LayoutInput { nodes: LayoutNode[]; edges: LayoutEdge[]; direction?: 'LR' | 'TB'; maxWidth?: number }
interface LayoutNode { id: string; x: number; y: number; w: number; h: number; ports: { name: string; dir: 'in' | 'out'; x: number; y: number }[] }
interface LayoutEdge { id: string; from: PortRef; to: PortRef }
type Positions = Record<string, { x: number; y: number }>;
```

## `layered(options?): LayoutEngine`

A Sugiyama-style layout:

- longest-path layering, with loops broken by depth-first search;
- barycentre ordering that respects port order;
- port-aligned placement within each layer;
- one uncrowded flow along `input.direction`: `'LR'` (columns, left to right; the default) or `'TB'` (rows, top to bottom);
- opt-in wrapping: with `maxWidth` and left-to-right flow, columns wrap into bands. The editor never asks for this.

| Option | Default | |
| --- | --- | --- |
| `layerGap` | 120 | space between layers, along the flow |
| `nodeGap` | 56 | space between nodes in a layer |
| `bandGap` | 100 | space between wrapped bands |
| `sweeps` | 8 | crossing-reduction passes |

`gapX`, `gapY` and `rowGap` still work as deprecated aliases of `layerGap`, `nodeGap` and `bandGap`.

The result keeps the drawing's top-left where it was.

## `elkLayout(elk, { options? }): LayoutEngine`

The Eclipse Layout Kernel, with fixed port positions. Pass your own instance: `elkLayout(new ELK())`. It follows `direction` (`RIGHT` or `DOWN`, with ports on the matching sides). `maxWidth` turns on ELK's row wrapping.

## `Router`

Orthogonal wires that avoid nodes.

```ts
const router = new Router(rects: Rect[], { margin?: 14, stub?: 22, bendCost?: 28, shareCost?: 30 });
router.route(fromOutputPoint, toInputPoint, owner?, flow?: 'LR' | 'TB'): Point[] | null;
```

`owner` (for example the source port's id) lets wires from the same output share a trunk; others avoid shared segments. With `flow` `'TB'`, wires leave outputs downwards and enter inputs from above. Turn the points into a path with `roundedPath(points, radius?)`.

## `findFreeSpot(others, want, { gap?: 24, axis?: 'x' | 'y' | 'both' }): Point`

The nearest top-left position where a box of `want`'s size does not overlap `others`.

## Geometry helpers

`overlaps(a, b, gap?)`, `bounds(rects)`, `simplify(points)`, `roundedPath(points, r?)`, `bezierPath(a, b)`.
