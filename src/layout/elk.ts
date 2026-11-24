import type { LayoutEngine, LayoutInput, Positions } from './types.js';

/** The subset of the elkjs API this adapter needs (`new ELK()` from 'elkjs/lib/elk.bundled.js'). */
export interface ElkLike {
  layout(graph: any, args?: any): Promise<any>;
}

export interface ElkLayoutOptions {
  /** Extra ELK layout options, merged over the defaults. */
  options?: Record<string, string>;
}

/**
 * Layout with the Eclipse Layout Kernel (elkjs), keeping port positions fixed so wires
 * leave from the real ports. Pass your own ELK instance so elkjs stays an optional dependency:
 *
 *   import ELK from 'elkjs/lib/elk.bundled.js';
 *   editor.setLayout(elkLayout(new ELK()));
 *
 * When the input has `maxWidth`, ELK's row wrapping is enabled with a matching aspect ratio.
 */
export function elkLayout(elk: ElkLike, opts: ElkLayoutOptions = {}): LayoutEngine {
  return async (input: LayoutInput): Promise<Positions> => {
    const totalArea = input.nodes.reduce((a, n) => a + (n.w + 80) * (n.h + 40), 0);
    const wrap: Record<string, string> = input.maxWidth
      ? {
          'elk.layered.wrapping.strategy': 'MULTI_EDGE',
          // width / height, where height ≈ area / width
          'elk.aspectRatio': String(Math.max(0.2, (input.maxWidth * input.maxWidth) / totalArea)),
          'elk.layered.wrapping.additionalEdgeSpacing': '20',
        }
      : {};
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': input.direction === 'TB' ? 'DOWN' : 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '56',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
        ...wrap,
        ...opts.options,
      },
      children: input.nodes.map((n) => ({
        id: n.id,
        width: n.w,
        height: n.h,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS', 'elk.position': `(${n.x},${n.y})` },
        ports: n.ports.map((p) => ({
          id: `${n.id}\u0000${p.dir}\u0000${p.name}`,
          x: p.x - 1,
          y: p.y - 1,
          width: 2,
          height: 2,
          layoutOptions: {
            'elk.port.side': input.direction === 'TB' ? (p.dir === 'in' ? 'NORTH' : 'SOUTH') : p.dir === 'in' ? 'WEST' : 'EAST',
          },
        })),
      })),
      edges: input.edges.map((e) => ({
        id: e.id,
        sources: [`${e.from.node}\u0000out\u0000${e.from.port}`],
        targets: [`${e.to.node}\u0000in\u0000${e.to.port}`],
      })),
    };
    const res = await elk.layout(graph);
    const before = input.nodes.reduce((m, n) => ({ x: Math.min(m.x, n.x), y: Math.min(m.y, n.y) }), { x: Infinity, y: Infinity });
    const out: Positions = {};
    for (const c of res.children ?? []) out[c.id] = { x: Math.round(c.x + before.x), y: Math.round(c.y + before.y) };
    return out;
  };
}
