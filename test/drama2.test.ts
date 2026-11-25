// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Evaluator, NodeEditor, drama2Graph, dramaGraph, toDrama, fromDrama, drama2Lists, seedanceShot, getGraphType } from '../src/index';

const load = (id = 'term') => Graph.fromJSON(drama2Graph.examples!.find((e) => e.id === id)!.graph, drama2Graph.createRegistry());
const view = (id: string) => drama2Graph.editor!.views!.find((v) => v.id === id)!;
const titles = (g: Graph, id: string, list: string) => drama2Lists(g, toDrama(g), id).find((l) => l.title === list)!.items.map((i) => i.title);

describe('Drama boards (drama2)', () => {
  it('is registered with four views and no ports', () => {
    expect(getGraphType('drama2')).toBe(drama2Graph);
    expect(drama2Graph.editor!.views!.map((v) => [v.id, v.layout])).toEqual([
      ['cast', 'grid'],
      ['locations', 'grid'],
      ['scenes', 'rows'],
      ['episodes', 'rows'],
    ]);
    const reg = drama2Graph.createRegistry();
    for (const t of reg.list()) expect([t.inputs?.length ?? 0, t.outputs?.length ?? 0]).toEqual([0, 0]);
  });

  it('converts from wires to references and back', () => {
    const g = load();
    expect(g.edges.size).toBe(0);
    expect(g.nodes.get('s1a')!.params).toMatchObject({ location: 'hall', characters: ['maya', 'theo', 'jules', 'okafor'] });
    expect(g.nodes.get('sc1')!.params.shots).toEqual(['s1a', 's1b', 's1c']);
    expect(g.nodes.get('jules-lead')!.params).toMatchObject({ character: 'jules', scenes: ['sc4'] });
    expect(g.nodes.get('ep1')!.params.style).toContain('35mm film look'); // handed down from the season
    // The wired version gives the same Seedance shots as the drama example (props are names only here).
    const wired = toDrama(g);
    const original = Graph.fromJSON(dramaGraph.examples![0].graph, dramaGraph.createRegistry());
    expect(seedanceShot(wired, 's4c').prompt).toBe(seedanceShot(original, 's4c').prompt);
    expect(fromDrama(dramaGraph.examples![0].graph).nodes.find((n) => n.id === 's1b')!.params.props).toBe('Dog-eared script');
  });

  it('lists where things appear', async () => {
    const g = load();
    expect(titles(g, 'maya', 'Scenes')).toEqual(['Ep 1 · Scene 1 · DAY', 'Ep 1 · Scene 2 · NIGHT', 'Ep 2 · Scene 1 · NIGHT']);
    expect(titles(g, 'maya', 'Episodes')).toEqual(['Episode 1: The Read-Through', 'Episode 2: Opening Night']);
    expect(titles(g, 'maya', 'Outfits')).toEqual(['Stage blacks']);
    expect(titles(g, 'park', 'Episodes')).toEqual(['Episode 1: The Read-Through']);
    expect(titles(g, 's3b', 'Episodes')).toEqual(['Episode 1: The Read-Through']);
    expect(titles(g, 'ep2', 'Actors')).toEqual(['Maya (Priya S.)', 'Jules (Alex K.)']);
    expect(titles(g, 'ep2', 'Locations')).toEqual(['School hall', 'Backstage']);
    const r = await new Evaluator(g, g.registry!).run();
    expect(String(r.outputs.summary)).toMatch(/^2 episodes · 4 scenes · 10 shots · 4 characters/);
    expect((r.results.get('maya')!.outputs!.lists as { title: string }[]).map((l) => l.title)).toEqual(['Scenes', 'Episodes', 'Outfits']);
  });

  it('adds new shots, scenes and outfits to what is selected', () => {
    const g = load();
    const shot = g.addNode('drama2/shot');
    view('scenes').onAdd!(shot, { graph: g, selected: g.nodes.get('s2b') });
    expect(g.nodes.get('sc2')!.params.shots).toEqual(['s2a', 's2b', shot.id]);
    expect(shot.params.number).toBe('3');
    const scene = g.addNode('drama2/scene');
    view('episodes').onAdd!(scene, { graph: g, selected: g.nodes.get('ep2') });
    expect(g.nodes.get('ep2')!.params.scenes).toEqual(['sc4', scene.id]);
    expect(scene.params.number).toBe(2);
    const outfit = g.addNode('drama2/outfit');
    view('cast').onAdd!(outfit, { graph: g, selected: g.nodes.get('theo') });
    expect(outfit.params.character).toBe('theo');
  });
});

describe('Editor views', () => {
  const mount = () => {
    const g = load();
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    return { g, el, editor };
  };
  const shown = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.nm-node')].filter((n) => !n.hidden).map((n) => n.dataset.id);

  it('shows one view at a time with a tab per view', async () => {
    const { el, editor } = mount();
    expect([...el.querySelectorAll('.nm-view-tab')].map((t) => t.textContent)).toEqual(['Cast6', 'Locations3', 'Scenes14', 'Episodes6']);
    expect(shown(el)).toEqual(['maya', 'theo', 'jules', 'okafor', 'jules-lead', 'maya-blacks']);
    await editor.setView('scenes');
    expect(editor.currentView).toBe('scenes');
    expect(shown(el)).toHaveLength(14);
    expect(el.querySelectorAll('.nm-port')).toHaveLength(0);
    editor.destroy();
  });

  it('lays out grids and rows', async () => {
    const { g, editor } = mount();
    await editor.layoutView({ animate: false });
    // Each character, then their outfits.
    const ys = (ids: string[]) => ids.map((id) => g.nodes.get(id)!.y);
    const reading = ['maya', 'maya-blacks', 'theo', 'jules', 'jules-lead', 'okafor'].sort((a, b) => g.nodes.get(a)!.y - g.nodes.get(b)!.y || g.nodes.get(a)!.x - g.nodes.get(b)!.x);
    expect(reading).toEqual(['maya', 'maya-blacks', 'theo', 'jules', 'jules-lead', 'okafor']);
    await editor.setView('scenes');
    // One row per scene: the scene first, its shots after it on the same row.
    const row1 = ['sc1', 's1a', 's1b', 's1c'];
    expect(new Set(ys(row1)).size).toBe(1);
    expect(row1.map((id) => g.nodes.get(id)!.x)).toEqual([...row1.map((id) => g.nodes.get(id)!.x)].sort((a, b) => a - b));
    expect(g.nodes.get('sc2')!.y).toBeGreaterThan(g.nodes.get('sc1')!.y);
    editor.destroy();
  });

  it('jumps to a linked node in its view, and back', async () => {
    const { el, editor } = mount();
    await editor.setView('scenes');
    const chip = el.querySelector<HTMLButtonElement>('.nm-node[data-id="s1a"] [data-nm-open="hall"]')!;
    expect(chip.textContent).toBe('School hall');
    chip.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(editor.currentView).toBe('locations');
    expect(editor.selection.node).toBe('hall');
    expect(el.querySelector('.nm-view-back')).toBeTruthy();
    await editor.back();
    expect(editor.currentView).toBe('scenes');
    expect(editor.selection.node).toBeUndefined();
    editor.destroy();
  });

  it('offers only free shots when adding to a scene', () => {
    const { g, el, editor } = mount();
    void editor.setView('scenes');
    const loose = g.addNode('drama2/shot', { id: 'loose' });
    void loose;
    const pick = el.querySelector<HTMLSelectElement>('.nm-node[data-id="sc1"] .dr2-pick')!;
    expect([...pick.options].map((o) => o.value)).toEqual(['', 'loose']);
    pick.value = 'loose';
    pick.dispatchEvent(new Event('change'));
    expect(g.nodes.get('sc1')!.params.shots).toEqual(['s1a', 's1b', 's1c', 'loose']);
    editor.destroy();
  });
});
