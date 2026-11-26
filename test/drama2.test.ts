// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Evaluator, NodeEditor, drama2Graph, dramaGraph, toDrama, fromDrama, drama2Lists, seedanceShot, getGraphType, sceneCostumes, wearerOf } from '../src/index';

const load = (id = 'term') => Graph.fromJSON(drama2Graph.examples!.find((e) => e.id === id)!.graph, drama2Graph.createRegistry());
const view = (id: string) => drama2Graph.editor!.views!.find((v) => v.id === id)!;
const titles = (g: Graph, id: string, list: string) => drama2Lists(g, toDrama(g), id).find((l) => l.title === list)!.items.map((i) => i.title);

describe('Drama boards (drama2)', () => {
  it('is registered with six views and no ports', () => {
    expect(getGraphType('drama2')).toBe(drama2Graph);
    expect(drama2Graph.editor!.views!.map((v) => [v.id, v.layout])).toEqual([
      ['cast', 'grid'],
      ['locations', 'grid'],
      ['props', 'grid'],
      ['shots', 'grid'],
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
    // Costumes become props of type Outfit, on the shots their wearer is in.
    expect(g.nodes.get('jules-lead')!.type).toBe('drama2/prop');
    expect(g.nodes.get('jules-lead')!.params).toMatchObject({ kind: 'Outfit', wornBy: 'jules' });
    expect(g.nodes.get('script')!.params).toMatchObject({ kind: 'Object' });
    expect(g.nodes.get('s4c')!.params.props).toEqual(['jules-lead']);
    expect(g.nodes.get('s4a')!.params.props).toEqual(['maya-blacks']);
    expect(g.nodes.get('s1b')!.params.props).toEqual(['script']);
    expect(g.nodes.get('ep1')!.params.style).toContain('35mm film look'); // handed down from the season
    // The wired version gives the same Seedance shots as the drama example: outfits dress
    // their wearer, objects (with their pictures) are props.
    const wired = toDrama(g);
    const original = Graph.fromJSON(dramaGraph.examples![0].graph, dramaGraph.createRegistry());
    for (const id of ['s1b', 's4a', 's4c']) expect(seedanceShot(wired, id).prompt).toBe(seedanceShot(original, id).prompt);
    expect(seedanceShot(wired, 's1b').refs.map((r) => r.label)).toContain('Dog-eared script (prop)');
    expect(fromDrama(dramaGraph.examples![0].graph).nodes.filter((n) => n.type === 'drama2/prop')).toHaveLength(3);
  });

  it('lists where things appear', async () => {
    const g = load();
    expect(titles(g, 'maya', 'Scenes')).toEqual(['Ep 1 · Scene 1 · DAY', 'Ep 1 · Scene 2 · NIGHT', 'Ep 2 · Scene 1 · NIGHT']);
    expect(titles(g, 'maya', 'Episodes')).toEqual(['Episode 1: The Read-Through', 'Episode 2: Opening Night']);
    expect(titles(g, 'maya', 'Outfits')).toEqual(['Stage blacks']);
    expect(titles(g, 'park', 'Episodes')).toEqual(['Episode 1: The Read-Through']);
    expect(titles(g, 'script', 'Scenes')).toEqual(['Ep 1 · Scene 1 · DAY', 'Ep 2 · Scene 1 · NIGHT']);
    expect(titles(g, 'jules-lead', 'Episodes')).toEqual(['Episode 2: Opening Night']);
    expect(titles(g, 'sc4', 'Props')).toEqual(['Stage blacks (Maya)', 'Dog-eared script', 'Lead costume (Jules)']);
    expect(titles(g, 's3b', 'Episodes')).toEqual(['Episode 1: The Read-Through']);
    expect(titles(g, 'ep2', 'Actors')).toEqual(['Maya (Priya S.)', 'Jules (Alex K.)']);
    expect(titles(g, 'ep2', 'Locations')).toEqual(['School hall', 'Backstage']);
    const r = await new Evaluator(g, g.registry!).run();
    expect(String(r.outputs.summary)).toMatch(/^2 episodes · 4 scenes · 10 shots · 4 characters/);
    expect((r.results.get('maya')!.outputs!.lists as { title: string }[]).map((l) => l.title)).toEqual(['Scenes', 'Episodes', 'Outfits']);
  });

  it('adds new shots, scenes and props to what is selected', () => {
    const g = load();
    const shot = g.addNode('drama2/shot');
    view('shots').onAdd!(shot, { graph: g, selected: g.nodes.get('s2b') });
    expect(g.nodes.get('sc2')!.params.shots).toEqual(['s2a', 's2b', shot.id]);
    expect(shot.params.number).toBe('3');
    const scene = g.addNode('drama2/scene');
    // A new scene joins the selected scene's episode, numbered next.
    view('scenes').onAdd!(scene, { graph: g, selected: g.nodes.get('sc4') });
    expect(g.nodes.get('ep2')!.params.scenes).toEqual(['sc4', scene.id]);
    expect(scene.params.number).toBe(2);
    const episode = g.addNode('drama2/episode');
    view('episodes').onAdd!(episode, { graph: g });
    expect(episode.params.number).toBe(3);
    const fromShotsTab = g.addNode('drama2/shot');
    view('shots').onAdd!(fromShotsTab, { graph: g, selected: g.nodes.get('s3a') });
    expect(g.nodes.get('sc3')!.params.shots).toEqual(['s3a', 's3b', fromShotsTab.id]);
    const outfit = g.addNode('drama2/prop');
    view('props').onAdd!(outfit, { graph: g, selected: g.nodes.get('jules-lead') });
    expect(outfit.params).toMatchObject({ kind: 'Outfit', wornBy: 'jules' });
    const thing = g.addNode('drama2/prop');
    view('props').onAdd!(thing, { graph: g, selected: g.nodes.get('script') });
    expect(thing.params).toMatchObject({ kind: 'Object', wornBy: '' });
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
    expect([...el.querySelectorAll('.nm-view-tab')].map((t) => t.textContent)).toEqual(['Cast4', 'Locations3', 'Props3', 'Shots10', 'Scenes4', 'Episodes2']);
    expect(shown(el)).toEqual(['maya', 'theo', 'jules', 'okafor']);
    await editor.setView('scenes');
    expect(editor.currentView).toBe('scenes');
    expect(shown(el)).toEqual(['sc1', 'sc2', 'sc3', 'sc4']); // scenes only: shots are chips on them
    expect(el.querySelectorAll('.nm-port')).toHaveLength(0);
    editor.destroy();
  });

  it('lays out grids and rows', async () => {
    const { g, editor } = mount();
    await editor.layoutView({ animate: false });
    const ys = (ids: string[]) => ids.map((id) => g.nodes.get(id)!.y);
    const reading = (ids: string[]) => [...ids].sort((a, b) => g.nodes.get(a)!.y - g.nodes.get(b)!.y || g.nodes.get(a)!.x - g.nodes.get(b)!.x);
    // Props: outfits grouped by wearer (in cast order), then objects.
    await editor.setView('props');
    expect(reading(['script', 'jules-lead', 'maya-blacks'])).toEqual(['maya-blacks', 'jules-lead', 'script']);
    await editor.setView('scenes');
    // One wide scene card per row, in story order.
    const scenes = ['sc1', 'sc2', 'sc3', 'sc4'];
    expect(new Set(scenes.map((id) => g.nodes.get(id)!.x)).size).toBe(1);
    expect(ys(scenes)).toEqual([...ys(scenes)].sort((a, b) => a - b));
    expect(new Set(ys(scenes)).size).toBe(4);
    expect(g.registry!.get('drama2/scene')!.width).toBeGreaterThan(g.registry!.get('drama2/shot')!.width!);
    editor.destroy();
  });

  it('shapes grids to fill the screen when zoomed out', async () => {
    const { g, el, editor } = mount();
    // A wide screen: the ten shots spread into several columns, in story order.
    el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON() {} }) as DOMRect;
    await editor.setView('shots');
    const cols = (ids: string[]) => new Set(ids.map((id) => g.nodes.get(id)!.x)).size;
    const shots = ['s1a', 's1b', 's1c', 's2a', 's2b', 's3a', 's3b', 's4a', 's4b', 's4c'];
    const wide = cols(shots);
    expect(wide).toBeGreaterThan(2);
    expect(g.nodes.get('s1a')!.x).toBe(0);
    expect(g.nodes.get('s1b')!.x).toBeGreaterThan(0);
    // A tall, narrow screen: fewer columns.
    el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 900, width: 400, height: 900, toJSON() {} }) as DOMRect;
    await editor.layoutView({ animate: false, home: true });
    expect(cols(shots)).toBeLessThan(wide);
    // It opens zoomed out to show the whole grid.
    expect(editor.viewport.k).toBeLessThan(1);
    editor.destroy();
  });

  it('shows “worn by” only on outfits', async () => {
    const { g, el, editor } = mount();
    await editor.setView('props');
    const wornBy = (id: string) => !!el.querySelector(`.nm-node[data-id="${id}"] [data-param="wornBy"]`);
    expect(wornBy('jules-lead')).toBe(true);
    expect(wornBy('script')).toBe(false);
    g.setParam('script', 'kind', 'Outfit');
    expect(wornBy('script')).toBe(true);
    g.setParam('script', 'kind', 'Object');
    expect(wornBy('script')).toBe(false);
    // The edit sheet follows the type too.
    editor.openNodeEditor('script');
    const sheetField = () => document.querySelector('.nm-edit [data-param="wornBy"]')!.closest<HTMLElement>('.nm-edit-field')!;
    expect(sheetField().hidden).toBe(true);
    g.setParam('script', 'kind', 'Outfit');
    expect(sheetField().hidden).toBe(false);
    editor.closePalette();
    editor.destroy();
  });

  it('lets any character wear any outfit, shot by shot', async () => {
    const g = load();
    const node = (id: string) => g.nodes.get(id)!;
    // Maya's stage blacks, usually hers, put on Theo's close-up in scene 1 (he's the only one in it).
    g.setParam('s1b', 'props', [...(node('s1b').params.props as string[]), 'maya-blacks']);
    expect(wearerOf(g, node('s1b'), node('maya-blacks'))!.id).toBe('theo');
    expect(wearerOf(g, node('s4a'), node('maya-blacks'))!.id).toBe('maya');
    let wired = toDrama(g);
    const worn = (scene: string, who: string) => sceneCostumes(wired, scene).get(who);
    expect(worn('sc1', 'theo')!.id).toBe('maya-blacks@theo'); // a copy, worn by Theo
    expect(worn('sc1', 'theo')!.params.images).toEqual(node('maya-blacks').params.images);
    expect(worn('sc4', 'maya')!.id).toBe('maya-blacks'); // still Maya's in scene 4
    expect(seedanceShot(wired, 's1b').prompt).toMatch(/Theo .*Costume in this scene: All-black crew clothes/s);
    expect(titles(g, 'theo', 'Outfits')).toContain(node('maya-blacks').label);
    // A shot with several people: the usual wearer if they're in it, else whoever the shot picks.
    g.setParam('s1a', 'props', ['jules-lead']);
    expect(wearerOf(g, node('s1a'), node('jules-lead'))!.id).toBe('jules');
    g.setParam('s1a', 'wearers', { 'jules-lead': 'okafor' });
    expect(wearerOf(g, node('s1a'), node('jules-lead'))!.id).toBe('okafor');
    wired = toDrama(g);
    expect(worn('sc1', 'okafor')!.id).toBe('jules-lead@okafor');
    expect(worn('sc1', 'jules')).toBeUndefined();
    expect(titles(g, 'sc1', 'Props')).toContain(`${node('jules-lead').label} (Ms Okafor)`);
    // No usual wearer and several people: nobody is dressed until the shot says who.
    g.setParam('jules-lead', 'wornBy', '');
    g.setParam('s1a', 'wearers', {});
    expect(wearerOf(g, node('s1a'), node('jules-lead'))).toBeUndefined();
    expect([...sceneCostumes(toDrama(g), 'sc1').keys()]).toEqual(['theo']);
  });

  it('picks who wears an outfit from its chip on the shot', async () => {
    const { g, el, editor } = mount();
    await editor.setView('shots');
    g.setParam('s1a', 'props', ['jules-lead', 'script']);
    const pick = () => el.querySelector<HTMLSelectElement>('.nm-node[data-id="s1a"] [data-param="props"] .dr2-wearer')!;
    expect(el.querySelectorAll('.nm-node[data-id="s1a"] [data-param="props"] .dr2-wearer')).toHaveLength(1); // outfits only
    expect([...pick().options].map((o) => o.textContent)).toEqual(['on Maya', 'on Theo', 'on Jules', 'on Ms Okafor']);
    expect(pick().value).toBe('jules');
    pick().value = 'theo';
    pick().dispatchEvent(new Event('change'));
    expect(g.nodes.get('s1a')!.params.wearers).toEqual({ 'jules-lead': 'theo' });
    expect(pick().value).toBe('theo');
    // Saved and loaded with the map.
    const again = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())), drama2Graph.createRegistry());
    expect(wearerOf(again, again.nodes.get('s1a')!, again.nodes.get('jules-lead')!)!.id).toBe('theo');
    editor.destroy();
  });

  it('switches to a searchable chooser for long lists', async () => {
    const { g, el, editor } = mount();
    await editor.setView('shots');
    const picker = () => el.querySelector<HTMLElement>('.nm-node[data-id="s1a"] [data-param="characters"] .dr2-pick')!;
    // The shot already has all four characters; one new one is free: a plain select.
    g.addNode('drama2/character', { id: 'extra0', label: 'Zed' });
    expect(picker().tagName).toBe('SELECT');
    // Past eight free choices it becomes a button that opens a search sheet.
    for (let i = 1; i <= 9; i++) g.addNode('drama2/character', { id: `extra${i}`, label: `Extra ${i}`, params: { actor: i === 7 ? 'Robin Q.' : '' } });
    expect(picker().tagName).toBe('BUTTON');
    picker().click();
    await new Promise((r) => setTimeout(r, 10));
    const sheet = document.querySelector<HTMLElement>('.nm-choose')!;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelectorAll('.nm-sheet-item')).toHaveLength(11); // + New character, then the ten free ones
    expect(sheet.querySelector('.nm-sheet-item')!.textContent).toContain('+ New character');
    // Search matches names and hints (who plays them).
    const search = sheet.querySelector('input')!;
    search.value = 'robin';
    search.dispatchEvent(new Event('input'));
    expect([...sheet.querySelectorAll('.nm-sheet-item')].map((b) => b.getAttribute('data-id'))).toEqual(['extra7']);
    await new Promise((r) => setTimeout(r, 360)); // the guard against the opening tap
    sheet.querySelector<HTMLButtonElement>('.nm-sheet-item')!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('.nm-choose')).toBeNull();
    expect(g.nodes.get('s1a')!.params.characters).toEqual(['maya', 'theo', 'jules', 'okafor', 'extra7']);
    editor.destroy();
  });

  it('chooser closes without a pick and stacks over the edit sheet', async () => {
    const { editor } = mount();
    editor.openNodeEditor('maya');
    const pending = editor.choose({ title: 'Pick', items: [{ id: 'a', label: 'A' }] });
    expect(document.querySelector('.nm-edit')).toBeTruthy();
    const search = document.querySelector<HTMLInputElement>('.nm-choose input')!;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await pending).toBeUndefined();
    expect(document.querySelector('.nm-edit')).toBeTruthy(); // the edit sheet is still open
    editor.closePalette();
    editor.destroy();
  });

  it('shows episodes as wide cards whose scene chips open the Scenes tab', async () => {
    const { g, el, editor } = mount();
    await editor.setView('episodes');
    expect(shown(el)).toEqual(['ep1', 'ep2']);
    expect(g.nodes.get('ep1')!.x).toBe(g.nodes.get('ep2')!.x);
    expect(g.nodes.get('ep2')!.y).toBeGreaterThan(g.nodes.get('ep1')!.y);
    expect(g.registry!.get('drama2/episode')!.width).toBe(440);
    const chip = el.querySelector<HTMLButtonElement>('.nm-node[data-id="ep1"] [data-param="scenes"] [data-nm-open="sc2"]')!;
    expect(chip.textContent).toBe('Scene 2 · NIGHT');
    chip.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(editor.currentView).toBe('scenes');
    expect(editor.selection.node).toBe('sc2');
    editor.destroy();
  });

  it('opens a scene’s shot on the Shots tab', async () => {
    const { el, editor } = mount();
    await editor.setView('scenes');
    const chip = el.querySelector<HTMLButtonElement>('.nm-node[data-id="sc1"] [data-param="shots"] [data-nm-open="s1b"]')!;
    expect(chip.textContent).toBe('Shot 2 · Close-up');
    chip.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(editor.currentView).toBe('shots');
    expect(editor.selection.node).toBe('s1b');
    editor.destroy();
  });

  it('jumps to a linked node in its view, and back', async () => {
    const { el, editor } = mount();
    await editor.setView('shots');
    const chip = el.querySelector<HTMLButtonElement>('.nm-node[data-id="s1a"] [data-nm-open="hall"]')!;
    expect(chip.textContent).toBe('School hall');
    chip.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(editor.currentView).toBe('locations');
    expect(editor.selection.node).toBe('hall');
    expect(el.querySelector('.nm-view-back')).toBeTruthy();
    await editor.back();
    expect(editor.currentView).toBe('shots');
    expect(editor.selection.node).toBeUndefined();
    editor.destroy();
  });

  it('always offers to add characters to a shot, even when all are on it', async () => {
    const { g, el, editor } = mount();
    await editor.setView('shots');
    const sel = el.querySelector<HTMLSelectElement>('.nm-node[data-id="s1a"] [data-param="characters"] .dr2-pick')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['+ character…', '+ New character']);
    sel.value = [...sel.options][1].value;
    sel.dispatchEvent(new Event('change'));
    const added = (g.nodes.get('s1a')!.params.characters as string[]).at(-1)!;
    expect(g.nodes.get(added)!.type).toBe('drama2/character');
    expect(g.nodes.get(added)!.label).toBe('New character');
    editor.destroy();
  });

  it('adds, moves, creates and sorts shots from a scene card', async () => {
    const { g, el, editor } = mount();
    await editor.setView('scenes');
    editor.select({ node: 'sc1' });
    g.addNode('drama2/shot', { id: 'loose', params: { number: '9' } });
    const pick = () => el.querySelector<HTMLSelectElement>('.nm-node[data-id="sc1"] [data-param="shots"] .dr2-pick')!;
    const choose = (match: (o: HTMLOptionElement) => boolean) => {
      const sel = pick();
      sel.value = [...sel.options].find(match)!.value;
      sel.dispatchEvent(new Event('change'));
    };
    const labels = [...pick().options].map((o) => o.textContent);
    expect(labels[0]).toBe('+ shot…');
    expect(labels[1]).toBe('+ New shot');
    expect(labels).toContain('Shot 9 · Medium');
    expect(labels).toContain('Shot 1 · Medium (in Scene 2 · NIGHT)');
    const shots = (id: string) => g.nodes.get(id)!.params.shots as string[];
    const numbers = (id: string) => shots(id).map((x) => g.nodes.get(x)!.params.number);

    // A free shot joins, numbered after the others.
    choose((o) => o.value === 'loose');
    expect(shots('sc1')).toEqual(['s1a', 's1b', 's1c', 'loose']);
    expect(numbers('sc1')).toEqual(['1', '2', '3', '4']);

    // A shot from another scene moves here; both scenes renumber.
    choose((o) => o.textContent!.startsWith('Shot 1 · Medium (in Scene 2'));
    expect(shots('sc2')).toEqual(['s2b']);
    expect(numbers('sc2')).toEqual(['1']);
    expect(shots('sc1').at(-1)).toBe('s2a');
    expect(numbers('sc1')).toEqual(['1', '2', '3', '4', '5']);

    // "+ New shot" creates one in place.
    choose((o) => o.textContent === '+ New shot');
    const created = shots('sc1').at(-1)!;
    expect(g.nodes.get(created)!.type).toBe('drama2/shot');
    expect(g.nodes.get(created)!.params.number).toBe('6');

    // ‹ moves a shot earlier, and the numbers follow.
    const earlier = el.querySelector<HTMLButtonElement>('.nm-node[data-id="sc1"] [data-param="shots"] .dr2-chip:nth-child(3) .dr2-mv')!;
    expect(earlier.getAttribute('aria-label')).toMatch(/earlier/);
    earlier.click();
    expect(shots('sc1').slice(0, 3)).toEqual(['s1a', 's1c', 's1b']);
    expect(g.nodes.get('s1c')!.params.number).toBe('2');
    expect(g.nodes.get('s1b')!.params.number).toBe('3');
    editor.destroy();
  });

  it('adds, moves and sorts scenes from an episode card', async () => {
    const { g, el, editor } = mount();
    await editor.setView('episodes');
    editor.select({ node: 'ep2' });
    const sel = el.querySelector<HTMLSelectElement>('.nm-node[data-id="ep2"] [data-param="scenes"] .dr2-pick')!;
    sel.value = [...sel.options].find((o) => o.textContent!.startsWith('Scene 3 · EVENING (in'))!.value;
    sel.dispatchEvent(new Event('change'));
    expect(g.nodes.get('ep1')!.params.scenes).toEqual(['sc1', 'sc2']);
    expect(g.nodes.get('ep2')!.params.scenes).toEqual(['sc4', 'sc3']);
    expect(g.nodes.get('sc3')!.params.number).toBe(2); // scene numbers stay numbers
    editor.destroy();
  });
});
