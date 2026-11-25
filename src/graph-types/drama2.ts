import { defineGraphType } from '../core/graph-type.js';
import type { Graph } from '../core/graph.js';
import type { NodeInstance } from '../core/types.js';
import { D2, drama2Engine, drama2Pack, fromDrama, referrers, refsOf } from '../packs/drama2.js';
import { dramaGraph } from './drama.js';

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (n: NodeInstance | undefined) => Number(n?.params.number ?? 0) || 0;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const ofType = (g: Graph, type: string) => [...g.nodes.values()].filter((n) => n.type === type);

/** Scenes in story order: by episode, then scene number; scenes outside episodes last. */
function scenesInOrder(g: Graph): NodeInstance[] {
  const ep = (sc: NodeInstance) => referrers(g, sc.id, D2.episode, 'scenes')[0];
  return ofType(g, D2.scene).sort((a, b) => (num(ep(a)) || 1e9) - (num(ep(b)) || 1e9) || num(a) - num(b));
}
const shotsOf = (g: Graph, sc: NodeInstance) => refsOf(g, sc, 'shots').sort((a, b) => natural(String(a.params.number ?? ''), String(b.params.number ?? '')));
const nextNumber = (ns: NodeInstance[]) => Math.max(0, ...ns.map((n) => Number.parseInt(String(n.params.number ?? ''), 10) || 0)) + 1;
const push = (g: Graph, holder: NodeInstance, param: string, id: string) => g.setParam(holder.id, param, [...list(holder.params[param]), id]);

/**
 * Drama as boards instead of wires. Four tabs: Cast (characters and their outfits) and
 * Locations as grids; Scenes (each scene with its shots) and Episodes (each episode with its
 * scenes) in rows. Nodes refer to each other with chips you tap to jump between tabs, and
 * list where they appear. Under the hood it is the drama model, so the engine and the
 * Seedance export are the same.
 */
export const drama2Graph = defineGraphType({
  id: 'drama2',
  title: 'Drama boards',
  description: 'The drama production model as tabs of cards instead of wires: cast, locations, scenes and episodes, linked by tappable references.',
  icon: '🎬',
  packs: [drama2Pack],
  engine: drama2Engine,
  editor: {
    autoLayout: true,
    views: [
      { id: 'cast', title: 'Cast', types: [D2.character], layout: 'grid' },
      { id: 'locations', title: 'Locations', types: [D2.location], layout: 'grid' },
      {
        id: 'props',
        title: 'Props',
        types: [D2.prop],
        layout: 'grid',
        // Outfits first, grouped by who wears them; then objects.
        order: (g) => {
          const props = ofType(g, D2.prop);
          const outfits = props.filter((p) => p.params.kind === 'Outfit');
          const byWearer = ofType(g, D2.character).flatMap((c) => outfits.filter((o) => o.params.wornBy === c.id));
          return [...byWearer, ...outfits, ...props.filter((p) => p.params.kind !== 'Outfit')].map((p) => p.id);
        },
        // A new prop is the same type as the selected one (and worn by the same person).
        onAdd: (node, { graph, selected }) => {
          if (selected?.type !== D2.prop) return;
          graph.setParam(node.id, 'kind', selected.params.kind ?? 'Object');
          if (selected.params.kind === 'Outfit' && selected.params.wornBy) graph.setParam(node.id, 'wornBy', selected.params.wornBy);
        },
      },
      {
        id: 'scenes',
        title: 'Scenes',
        types: [D2.scene, D2.shot],
        layout: 'rows',
        // A row per scene: the scene, then its shots in order.
        rows: (g) => scenesInOrder(g).map((sc) => [sc.id, ...shotsOf(g, sc).map((s) => s.id)]),
        onAdd: (node, { graph, selected }) => {
          const sceneOf = (n?: NodeInstance) => (n?.type === D2.scene ? n : n?.type === D2.shot ? referrers(graph, n.id, D2.scene, 'shots')[0] : undefined);
          if (node.type === D2.shot) {
            const sc = sceneOf(selected);
            if (!sc) return;
            graph.setParam(node.id, 'number', String(nextNumber(refsOf(graph, sc, 'shots'))));
            push(graph, sc, 'shots', node.id);
          } else if (node.type === D2.scene) {
            // Next scene number, in the same episode as the selected scene.
            const ep = sceneOf(selected) && referrers(graph, sceneOf(selected)!.id, D2.episode, 'scenes')[0];
            graph.setParam(node.id, 'number', nextNumber(ep ? refsOf(graph, ep, 'scenes') : ofType(graph, D2.scene).filter((s) => s.id !== node.id)));
            if (ep) push(graph, ep, 'scenes', node.id);
          }
        },
      },
      {
        id: 'episodes',
        title: 'Episodes',
        types: [D2.episode, D2.scene],
        layout: 'rows',
        // A row per episode: the episode, then its scenes in order.
        rows: (g) =>
          ofType(g, D2.episode)
            .sort((a, b) => num(a) - num(b))
            .map((ep) => [ep.id, ...refsOf(g, ep, 'scenes').sort((a, b) => num(a) - num(b)).map((s) => s.id)]),
        onAdd: (node, { graph, selected }) => {
          if (node.type === D2.episode) return void graph.setParam(node.id, 'number', nextNumber(ofType(graph, D2.episode).filter((e) => e.id !== node.id)));
          const ep = selected?.type === D2.episode ? selected : selected?.type === D2.scene ? referrers(graph, selected.id, D2.episode, 'scenes')[0] : undefined;
          if (!ep) return;
          graph.setParam(node.id, 'number', nextNumber(refsOf(graph, ep, 'scenes')));
          push(graph, ep, 'scenes', node.id);
        },
      },
    ],
  },
  examples: (dramaGraph.examples ?? []).map((ex) => ({
    ...ex,
    description:
      ex.id === 'term'
        ? 'Tabs across the top: cast, locations, props (objects and outfits), scenes, episodes. Tap a name chip or a list entry to jump to it (← Back returns). Select a card to edit it or open its lists; tap a shot, scene or episode twice for its Seedance export.'
        : ex.description,
    graph: fromDrama(ex.graph),
  })),
});
