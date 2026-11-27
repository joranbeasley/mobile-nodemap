// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Evaluator, NodeEditor, drama2Graph, dramaGraph, toDrama, fromDrama, drama2Lists, seedanceShot, getGraphType, sceneCostumes, shotCostumes, wearerOf, dressOf, dramaImagePrompt, previousShot } from '../src/index';

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
    // Costumes become props of type Outfit, in the wardrobe of the scenes they were wired into.
    expect(g.nodes.get('jules-lead')!.type).toBe('drama2/prop');
    expect(g.nodes.get('jules-lead')!.params).toMatchObject({ kind: 'Outfit', wornBy: 'jules' });
    expect(g.nodes.get('script')!.params).toMatchObject({ kind: 'Object' });
    expect(g.nodes.get('sc4')!.params.wardrobe).toEqual({ jules: 'jules-lead', maya: 'maya-blacks' });
    expect(g.nodes.get('s4c')!.params.props).toEqual([]);
    expect(g.nodes.get('s4a')!.params.props).toEqual([]);
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

  it('shows “worn by” only on outfits, in the Edit sheet', async () => {
    const { g, el, editor } = mount();
    await editor.setView('props');
    // Cards are summaries: the type and who wears it are edited in the sheet.
    expect(el.querySelector('.nm-node[data-id="jules-lead"] [data-param="wornBy"]')).toBeNull();
    editor.openNodeEditor('script');
    const sheetField = () => document.querySelector('.nm-edit [data-param="wornBy"]')!.closest<HTMLElement>('.nm-edit-field')!;
    expect(sheetField().hidden).toBe(true);
    g.setParam('script', 'kind', 'Outfit');
    expect(sheetField().hidden).toBe(false);
    editor.closePalette();
    editor.destroy();
  });

  it('dresses characters by episode, scene or shot, each overriding the one above', () => {
    const g = load();
    const node = (id: string) => g.nodes.get(id)!;
    const wears = (at: string, who: string) => dressOf(g, node(at), who);
    // The example: scene 4 (episode 2) puts Maya in her stage blacks, for all its shots.
    expect(wears('sc4', 'maya')).toMatchObject({ from: 'scene', outfit: { id: 'maya-blacks' } });
    expect(wears('s4a', 'maya')).toMatchObject({ from: 'scene', outfit: { id: 'maya-blacks' } });
    expect(wears('s1a', 'maya')).toEqual({ from: 'none' });
    // On the episode: every scene and shot in it, unless a scene says otherwise.
    g.setParam('ep1', 'wardrobe', { theo: 'jules-lead' });
    expect(wears('s1b', 'theo')).toMatchObject({ from: 'episode', outfit: { id: 'jules-lead' } }); // anyone can wear it
    expect(wears('sc1', 'theo').from).toBe('episode');
    g.setParam('sc1', 'wardrobe', { theo: 'maya-blacks' });
    expect(wears('s1b', 'theo')).toMatchObject({ from: 'scene', outfit: { id: 'maya-blacks' } });
    // A shot overrides the scene, back to usual clothes too.
    g.setParam('s1a', 'wardrobe', { theo: '' });
    expect(wears('s1a', 'theo')).toEqual({ from: 'shot', outfit: undefined });
    expect(wears('s1b', 'theo').outfit!.id).toBe('maya-blacks');

    // The wired model (prompts, references, Seedance) follows, shot by shot.
    const wired = toDrama(g);
    expect(shotCostumes(wired, 's1b').get('theo')!.id).toBe('maya-blacks@theo'); // a copy, worn by Theo
    expect(shotCostumes(wired, 's1b').get('theo')!.params.images).toEqual(node('maya-blacks').params.images);
    expect(shotCostumes(wired, 's1a').has('theo')).toBe(false); // usual clothes in this one shot
    expect(sceneCostumes(wired, 'sc1').get('theo')!.id).toBe('maya-blacks@theo'); // what the scene says
    expect(shotCostumes(wired, 's4a').get('maya')!.id).toBe('maya-blacks');
    expect(seedanceShot(wired, 's1b').prompt).toMatch(/Theo .*Costume in this scene: All-black crew clothes/s);
    expect(seedanceShot(wired, 's1a').prompt).not.toMatch(/Costume/);
    // Scene 3 doesn't override the episode: Theo wears the episode's choice there.
    expect(wears('s3a', 'theo')).toMatchObject({ from: 'episode', outfit: { id: 'jules-lead' } });
    expect(shotCostumes(wired, 's3a').get('theo')!.id).toBe('jules-lead@theo');
    expect(titles(g, 'theo', 'Outfits')).toEqual([node('maya-blacks').label, node('jules-lead').label]);
    expect(titles(g, 'sc1', 'Props')).toContain(`${node('maya-blacks').label} (Theo)`);
    expect(titles(g, 'maya-blacks', 'Scenes')).toEqual(['Ep 1 · Scene 1 · DAY', 'Ep 2 · Scene 1 · NIGHT']);
    // Outfits still in a shot's props (as boards used to put them) count as set on that shot.
    g.setParam('s3b', 'props', ['jules-lead']);
    expect(wearerOf(g, node('s3b'), node('jules-lead'))).toBeDefined();
    expect(dressOf(g, node('s3b'), wearerOf(g, node('s3b'), node('jules-lead'))!.id).from).toBe('shot');
  });

  it('sets the wardrobe on episode, scene and shot cards, in their Edit sheets', async () => {
    const { g, el, editor } = mount();
    // Not on the cards (a row per character would make them long)…
    await editor.setView('shots');
    expect(el.querySelector('.nm-node[data-id="s4a"] [data-param="wardrobe"]')).toBeNull();
    // …but in each one's Edit sheet.
    let open = '';
    const sheet = (id: string) => {
      if (open !== id) (editor.closePalette(), editor.openNodeEditor(id), (open = id));
      return document.querySelector<HTMLElement>('.nm-edit [data-param="wardrobe"]')!;
    };
    const row = (id: string, who: string) => [...sheet(id).querySelectorAll<HTMLElement>('.dr2-wardrobe-row')].find((r) => r.textContent!.startsWith(who))!.querySelector('select')!;
    const label = (sel: HTMLSelectElement) => sel.selectedOptions[0].textContent;
    const choose = (sel: HTMLSelectElement, v: string) => {
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
    };
    // Scene 4 dresses Maya; its shot shows that as inherited.
    await editor.setView('scenes');
    expect(label(row('sc4', 'Maya'))).toBe('Stage blacks');
    expect(label(row('sc4', 'Jules'))).toBe('Lead costume');
    await editor.setView('shots');
    expect(label(row('s4a', 'Maya'))).toBe('Stage blacks (from scene)');
    expect([...row('s4a', 'Maya').options].map((o) => o.textContent)).toEqual([
      'Stage blacks (from scene)',
      'Usual clothes',
      'Stage blacks',
      'Lead costume (Jules’s)',
      '+ New outfit…',
    ]);
    // Override on the shot, then go back to the scene's.
    choose(row('s4a', 'Maya'), '');
    expect(g.nodes.get('s4a')!.params.wardrobe).toEqual({ maya: '' });
    expect(label(row('s4a', 'Maya'))).toBe('Usual clothes');
    choose(row('s4a', 'Maya'), row('s4a', 'Maya').options[0].value);
    expect(g.nodes.get('s4a')!.params.wardrobe).toEqual({});
    // The episode: everyone in its scenes, usual clothes until set.
    await editor.setView('episodes');
    expect(label(row('ep1', 'Theo'))).toBe('Usual clothes');
    choose(row('ep1', 'Theo'), 'jules-lead');
    await editor.setView('shots');
    expect(label(row('s1b', 'Theo'))).toBe('Lead costume (from scene)'); // the scene inherits it from the episode
    // A new outfit straight from a row: an outfit prop, usually worn by them.
    choose(row('s1b', 'Theo'), row('s1b', 'Theo').options[row('s1b', 'Theo').options.length - 1].value);
    const made = (g.nodes.get('s1b')!.params.wardrobe as Record<string, string>).theo;
    expect(g.nodes.get(made)!.params).toMatchObject({ kind: 'Outfit', wornBy: 'theo' });
    // Shots without characters say so.
    g.setParam('s1b', 'characters', []);
    expect(sheet('s1b').textContent).toMatch(/Add characters/);
    editor.closePalette();
    editor.destroy();
  });

  it('names a location’s views, and says in a shot which it uses', () => {
    const g = load();
    const [front, wings] = ['data:image/png;base64,RlJPTlQ=', 'data:image/png;base64,V0lOR1M='];
    g.setParam('hall', 'images', [front, wings]);
    g.setParam('hall', 'views', [
      { src: front, name: 'from the audience' },
      { src: wings, name: 'from the wings', description: 'Black curtain edge in the foreground, the seats beyond the stage lights.' },
    ]);
    // Unpicked: the first view leads, the other goes along, each by name.
    let shot = seedanceShot(toDrama(g), 's1b');
    expect(shot.refs.map((r) => r.label)).toEqual(expect.arrayContaining(['School hall (location, from the audience)', 'School hall (location, from the wings)']));
    expect(shot.prompt).toMatch(/Setting: School hall[^\n]*View: from the audience\./);
    // Picked for this shot: that view, named and described, in both prompts.
    g.setParam('s1b', 'referencePicks', { hall: wings });
    shot = seedanceShot(toDrama(g), 's1b');
    expect(shot.refs.filter((r) => r.label.startsWith('School hall')).map((r) => r.label)).toEqual(['School hall (location, from the wings)']);
    expect(shot.prompt).toContain('View: from the wings — Black curtain edge in the foreground, the seats beyond the stage lights.');
    const w = toDrama(g);
    expect(dramaImagePrompt(w, w.nodes.get('s1b')!)!.prompt).toContain('View: from the wings — Black curtain edge');
    expect(dramaImagePrompt(w, w.nodes.get('s1b')!)!.references.find((r) => r.card === 'hall')!.label).toBe('School hall (location, from the wings)');
  });

  it('edits a location’s views in its Edit sheet', async () => {
    const g = load();
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    await editor.setView('locations');
    const [front, wings] = ['data:image/png;base64,RlJPTlQ=', 'data:image/png;base64,V0lOR1M='];
    g.setParam('hall', 'images', [front, wings]);
    expect(el.querySelector('.nm-node[data-id="hall"] [data-param="views"]')).toBeNull(); // not on the card
    editor.openNodeEditor('hall');
    const rows = () => [...document.querySelectorAll<HTMLElement>('.nm-edit [data-param="views"] .dr-view')];
    expect(rows()).toHaveLength(2);
    const name = rows()[1].querySelector('input')!;
    name.value = 'from the wings';
    name.dispatchEvent(new Event('change'));
    const desc = rows()[1].querySelector('textarea')!;
    desc.value = 'Curtain edge in front';
    desc.dispatchEvent(new Event('change'));
    expect(g.nodes.get('hall')!.params.views).toEqual([{ src: wings, name: 'from the wings', description: 'Curtain edge in front' }]);
    // A picture removed: its view goes with it on the next save.
    g.setParam('hall', 'images', [wings]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('input')!.value).toBe('from the wings');
    editor.closePalette();
    editor.destroy();
  });

  it('starts a continuing shot on the last frame of the shot before; otherwise matches it', () => {
    const g = load();
    const END = 'data:image/jpeg;base64,RU5EMQ==';
    const shot = (id: string) => seedanceShot(toDrama(g), id);
    expect(previousShot(toDrama(g), toDrama(g).nodes.get('s1b')!)!.id).toBe('s1a');
    expect(previousShot(toDrama(g), toDrama(g).nodes.get('s1a')!)).toBeUndefined();
    // Shot 1's finished clip: shot 2 (a cut) gets its end as a continuity reference.
    g.setParam('s1a', 'lastFrame', END);
    let s2 = shot('s1b');
    const k = s2.refs.findIndex((r) => r.label === 'End of shot 1 (continuity)');
    expect(k).toBeGreaterThan(0);
    expect(s2.prompt).toContain(`Keep props, positions and lighting continuous with how shot 1 ended (@Image${k + 1}).`);
    expect(s2.markdown).not.toContain('Continues shot');
    // Shot 2 carries on from shot 1: that frame is @Image1 and the first frame.
    g.setParam('s1b', 'continues', true);
    s2 = shot('s1b');
    expect(s2.refs[0]).toMatchObject({ src: END, label: "Last frame of shot 1's clip (first frame)" });
    expect(s2.prompt).toContain('Start exactly on @Image1, the last frame of shot 1, as the first frame, and carry the action on from there without a cut');
    expect(s2.prompt).not.toContain('Match the composition');
    expect(s2.markdown).toContain('**Continues shot 1.** Use @Image1');
    // The picture prompt and references say so too.
    const pic = dramaImagePrompt(toDrama(g), toDrama(g).nodes.get('s1b')!)!;
    expect(pic.references[0]).toEqual({ src: END, label: 'End of shot 1 (this shot carries on from it)' });
    expect(pic.prompt).toContain('It carries straight on from the previous shot, without a cut.');
    // No clip on shot 1 yet: the export says what to do.
    g.setParam('s1a', 'lastFrame', '');
    s2 = shot('s1b');
    expect(s2.refs.some((r) => r.src === END)).toBe(false);
    expect(s2.prompt).toContain('Carries straight on from shot 1 without a cut.');
    expect(s2.markdown).toContain("Add shot 1's finished clip to its card");
    // The first shot of a scene has nothing to carry on from.
    g.setParam('s1a', 'continues', true);
    expect(shot('s1a').prompt).not.toMatch(/carr(y|ies) .* on from/i);
  });

  it('keeps a shot’s finished clip as its last frame', async () => {
    const { g, el, editor } = mount();
    await editor.setView('shots');
    // No clip yet: the field is in the Edit sheet, not on the card.
    expect(el.querySelector('.nm-node[data-id="s1a"] [data-param="lastFrame"]')).toBeNull();
    editor.openNodeEditor('s1a');
    await new Promise((r) => setTimeout(r, 360)); // the sheet's guard against the opening tap
    const field = () => document.querySelector<HTMLElement>('.nm-edit [data-param="lastFrame"]')!;
    expect(field().querySelector('.dr-clip-btn')!.textContent).toBe('🎞 Add finished clip…');
    expect(field().querySelector('input[type=file]')!.getAttribute('accept')).toBe('video/*');
    expect(document.querySelector<HTMLInputElement>('.nm-edit input[type=checkbox][data-key="p:continues"]')!.checked).toBe(false);
    // Set from elsewhere (undo, a save from another device): the field shows the frame.
    g.setParam('s1a', 'lastFrame', 'data:image/jpeg;base64,QUJD');
    expect(field().querySelector<HTMLImageElement>('.dr-clip-thumb img')!.getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(field().textContent).toContain('Last frame of the finished clip');
    // × removes it.
    field().querySelector<HTMLButtonElement>('[aria-label="Remove the clip"]')!.click();
    expect(g.nodes.get('s1a')!.params.lastFrame).toBe('');
    expect(field().querySelector('.dr-clip-thumb')).toBeNull();
    // With a clip, the card is the clip: its frame big, where and who, and nothing else.
    g.setParam('s1a', 'lastFrame', 'data:image/jpeg;base64,QUJD');
    const card = el.querySelector<HTMLElement>('.nm-node[data-id="s1a"]')!;
    expect(card.querySelector('.dr-clip-card img')!.getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(card.querySelector('.dr-clip-sum')!.textContent).toBe('School hall · Maya · Theo · Jules · Ms Okafor');
    expect([...card.querySelectorAll('[data-param]')].map((x) => x.getAttribute('data-param'))).toEqual(['lastFrame']);
    expect(card.querySelector('.dr-clip-play')).toBeNull(); // added by hand: no video kept, so nothing to play
    // The Edit sheet still has the whole clip field.
    expect(field().querySelector('.dr-clip-thumb')).not.toBeNull();
    editor.closePalette();
    editor.destroy();
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

  it('edits shots in their sheet, from ✎ Edit on the card', async () => {
    const { el, editor } = mount();
    await editor.setView('shots');
    const card = el.querySelector<HTMLElement>('.nm-node[data-id="s1a"]')!;
    expect(card.classList.contains('nm-summary')).toBe(true);
    const sheets: unknown[] = [];
    editor.on('sheet', (x) => sheets.push(x));
    card.querySelector<HTMLButtonElement>('.nm-card-pencil')!.click();
    expect(document.querySelector('.nm-edit')!.getAttribute('aria-label')).toBe('Edit Shot 1 · Wide');
    editor.closePalette();
    editor.openFieldSheet('s1a', 'images', '✨ Frame', 'dr-generate');
    editor.closePalette();
    // Hosts can keep these in the address (to reopen the same sheet after a reload).
    expect(sheets).toEqual([{ node: 's1a' }, {}, { node: 's1a', param: 'images', title: '✨ Frame', event: 'dr-generate' }, {}]);
    // Its Seedance export opens from Export (not on every tap).
    card.querySelector<HTMLButtonElement>('.nm-card-details')!.click();
    expect(document.querySelector('.nm-card')!.textContent).toMatch(/Seedance shot/);
    editor.hideDetails?.();
    // Every card is the same: look-only, ✎ Edit (and ⓘ Details for its info card).
    await editor.setView('cast');
    const maya = el.querySelector<HTMLElement>('.nm-node[data-id="maya"]')!;
    expect(maya.classList.contains('nm-summary')).toBe(true);
    expect([...maya.querySelectorAll('.nm-card-row button')].map((b) => b.textContent)).toEqual(['ⓘ Details', '✎ Edit']);
    editor.destroy();
  });

  it('jumps to a linked node in its view, and back', async () => {
    const { el, editor } = mount();
    await editor.setView('shots');
    // Chips on a card (look-only or not) jump to what they name.
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
