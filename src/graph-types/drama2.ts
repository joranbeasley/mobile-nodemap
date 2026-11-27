import { defineGraphType } from '../core/graph-type.js';
import type { Graph } from '../core/graph.js';
import type { NodeInstance } from '../core/types.js';
import { D2, drama2Engine, drama2Pack, fromDrama, nodeTitle, referrers, refsOf } from '../packs/drama2.js';
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

/** The scene a selection belongs to: the scene itself, or a shot's scene. */
const sceneOf = (g: Graph, n?: NodeInstance) => (n?.type === D2.scene ? n : n?.type === D2.shot ? referrers(g, n.id, D2.scene, 'shots')[0] : undefined);

/** A new shot joins the selected scene (or the selected shot's scene), numbered next. */
function addShotTo(graph: Graph, shot: NodeInstance, selected?: NodeInstance) {
  const sc = sceneOf(graph, selected);
  if (!sc) return;
  graph.setParam(shot.id, 'number', String(nextNumber(refsOf(graph, sc, 'shots'))));
  push(graph, sc, 'shots', shot.id);
}

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
        id: 'shots',
        title: 'Shots',
        types: [D2.shot],
        layout: 'grid',
        // Story order: by episode and scene, then shot number; shots not in a scene last.
        order: (g) => scenesInOrder(g).flatMap((sc) => shotsOf(g, sc).map((s) => s.id)),
        // Each scene a box around its shots (a shot in two scenes shows in both); tap its header
        // to open the scene on the Scenes tab. Shots in no scene go in a last box.
        groups: (g) => [
          ...scenesInOrder(g).map((sc) => {
            const ep = referrers(g, sc.id, D2.episode, 'scenes')[0];
            const words = String(sc.params.description ?? '').trim();
            return {
              id: sc.id,
              title: nodeTitle(g, sc),
              subtitle: [ep ? nodeTitle(g, ep) : '', words].filter(Boolean).join(' — '),
              nodes: shotsOf(g, sc).map((s) => s.id),
              open: sc.id,
              color: '#5f3dc4',
            };
          }),
          { id: '', title: 'Not in a scene', nodes: ofType(g, D2.shot).filter((s) => !referrers(g, s.id, D2.scene, 'shots').length).map((s) => s.id) },
        ],
        // A shot dragged into a scene's box joins it (numbered next there), leaving the scene it
        // came from; into "Not in a scene", it leaves its scene.
        onDrop: (id, to, from, graph) => {
          const shot = graph.nodes.get(id);
          if (!shot) return;
          if (from?.id) {
            const sc = graph.nodes.get(from.id);
            if (sc) graph.setParam(sc.id, 'shots', refsOf(graph, sc, 'shots').map((s) => s.id).filter((x) => x !== id));
          }
          const target = to.id ? graph.nodes.get(to.id) : undefined;
          if (target?.type === D2.scene) {
            const shots = refsOf(graph, target, 'shots');
            graph.setParam(shot.id, 'number', String(nextNumber(shots)));
            graph.setParam(target.id, 'shots', [...shots.map((s) => s.id), id]);
          }
        },
        onAdd: (node, { graph, selected }) => addShotTo(graph, node, selected),
      },
      {
        id: 'scenes',
        title: 'Scenes',
        types: [D2.scene],
        layout: 'rows',
        // One wide scene card per row, in story order. Its shots are chips on the card: tap one
        // to open it on the Shots tab.
        rows: (g) => scenesInOrder(g).map((sc) => [sc.id]),
        onAdd: (node, { graph, selected }) => {
          // Next scene number, in the same episode as the selected scene.
          const sel = sceneOf(graph, selected);
          const ep = sel && referrers(graph, sel.id, D2.episode, 'scenes')[0];
          graph.setParam(node.id, 'number', nextNumber(ep ? refsOf(graph, ep, 'scenes') : ofType(graph, D2.scene).filter((s) => s.id !== node.id)));
          if (ep) push(graph, ep, 'scenes', node.id);
        },
      },
      {
        id: 'episodes',
        title: 'Episodes',
        types: [D2.episode],
        layout: 'rows',
        // One wide episode card per row, by number. Its scenes are chips on the card: tap one to
        // open it on the Scenes tab.
        rows: (g) => ofType(g, D2.episode).sort((a, b) => num(a) - num(b)).map((ep) => [ep.id]),
        onAdd: (node, { graph }) => graph.setParam(node.id, 'number', nextNumber(ofType(graph, D2.episode).filter((e) => e.id !== node.id))),
      },
    ],
  },
  examples: (dramaGraph.examples ?? []).map((ex) => ({
    ...ex,
    description:
      ex.id === 'term'
        ? 'Tabs across the top: cast, locations, props (objects and outfits), shots, scenes, episodes. Grids open zoomed out: tap a card to zoom in. Tap a name chip or a list entry to jump to it (← Back returns). Select a card to edit it or open its lists; tap a shot, scene or episode twice for its Seedance export.'
        : ex.description,
    graph: fromDrama(ex.graph),
  })),
});
