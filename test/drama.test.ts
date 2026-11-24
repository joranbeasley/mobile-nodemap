// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Evaluator, NodeEditor, dramaGraph, shotList, appearances, sceneInfo, getGraphType, type DramaStatus } from '../src/index';

const load = (id: string) => Graph.fromJSON(dramaGraph.examples!.find((e) => e.id === id)!.graph, dramaGraph.createRegistry());
const run = (g: Graph) => new Evaluator(g, g.registry!).run();
const st = (r: Awaited<ReturnType<typeof run>>, id: string) => r.results.get(id)!.outputs!.drama as DramaStatus;

describe('Drama graph type', () => {
  it('is registered with its nodes', () => {
    expect(getGraphType('drama')).toBe(dramaGraph);
    const reg = dramaGraph.createRegistry();
    for (const t of ['location', 'character', 'prop', 'shot', 'scene', 'episode', 'season']) expect(reg.get(`drama/${t}`)).toBeTruthy();
    expect(reg.paramKind('images')).toBeTruthy();
  });

  it('gives a shot one location and many characters', () => {
    const g = load('term');
    expect(sceneInfo(g, g.nodes.get('sc1')!).shots[0].characters.map((c) => c.label)).toEqual(['Maya', 'Theo', 'Jules', 'Ms Okafor']);
    // Wiring a second location replaces the first.
    g.connect({ node: 'park', port: 'shots' }, { node: 's1a', port: 'location' });
    expect(g.incoming('s1a').filter((e) => e.to.port === 'location')).toHaveLength(1);
    expect(g.incoming('s1a').find((e) => e.to.port === 'location')!.from.node).toBe('park');
  });

  it('keeps shots in one scene and scenes in one episode', () => {
    const g = load('term');
    expect(g.canConnect({ node: 's1a', port: 'scene' }, { node: 'sc2', port: 'shots' })).toMatch(/one scene/);
    expect(g.canConnect({ node: 'sc1', port: 'episode' }, { node: 'ep2', port: 'scenes' })).toMatch(/one episode/);
    // Characters and locations fan out freely.
    expect(g.canConnect({ node: 'theo', port: 'appears' }, { node: 's4c', port: 'characters' })).toBeNull();
  });

  it('breaks the production down', async () => {
    const g = load('term');
    const r = await run(g);
    expect(r.outputs).toMatchObject({ episodes: 2, scenes: 4, shots: 10, characters: 4, locations: 3, warnings: 0 });
    expect(st(r, 'jules').line).toBe('3 scenes · 5 shots');
    expect(st(r, 'sc1').sub).toMatch(/^INT\. SCHOOL HALL — DAY/);
    expect(st(r, 'sc1').line).toBe('3 shots · 0:17');
    expect(st(r, 'sc1').strip).toHaveLength(3);
    expect(st(r, 'ep1').line).toBe('Episode 1 · 3 scenes · 7 shots · 0:43');
    expect(String(r.outputs.summary)).toMatch(/^2 episodes · 4 scenes · 10 shots · 4 characters/);
  });

  it('flags missing locations, loose shots and duplicate scene numbers', async () => {
    const g = load('term');
    g.removeNode('park');
    g.addNode('drama/shot', { id: 'loose' });
    g.disconnect([...g.edges.values()].find((e) => e.from.node === 'sc4')!.id);
    g.connect({ node: 'sc4', port: 'episode' }, { node: 'ep1', port: 'scenes' }); // scene 1 twice in episode 1
    const r = await run(g);
    expect(st(r, 's3a').warnings).toContain('No location');
    expect(st(r, 'loose').warnings).toEqual(['No location', 'Not in a scene']);
    expect(st(r, 'ep1').warnings).toContain('Two scenes numbered 1');
    expect(g.validate().some((i) => /Shot 1 has no location/.test(i.message))).toBe(true);
  });

  it('writes shot lists and appearances', () => {
    const g = load('term');
    const ep = shotList(g, 'ep1');
    expect(ep).toMatch(/^EPISODE 1: The Read-Through/);
    expect(ep).toContain('SCENE 3. EXT. CAR PARK — EVENING');
    expect(ep.indexOf('SCENE 1.')).toBeLessThan(ep.indexOf('SCENE 2.'));
    expect(shotList(g)).toMatch(/^SPRING TERM \(1\), 2 episodes/);
    expect(appearances(g, 'script').map((a) => a.shot.number)).toEqual(['2', '2']);
    const card = g.registry!.get('drama/character')!.details!(g.nodes.get('theo')!, { graph: g });
    expect(card.code!.text).toContain('Played by Sam R.');
    expect(card.code!.text).toContain('Ep 1 The Read-Through · Scene 3 · shot 1 (Wide) at Car park');
  });

  it('edits image lists on the node', async () => {
    const g = load('scene');
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, evaluator: new Evaluator(g, g.registry!) });
    const imgs = () => el.querySelector('[data-id="b"] [data-param-kind="images"]')!;
    expect(imgs().querySelectorAll('.dr-thumb')).toHaveLength(1);
    (imgs().querySelector('.dr-rm') as HTMLButtonElement).click();
    expect(g.nodes.get('b')!.params.images).toEqual([]);
    expect(imgs().querySelector('.dr-add')!.textContent).toBe('+ Add images');
    g.setParam('b', 'images', ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
    // Shots and scenes without a name take their header from their params.
    const title = (id: string) => el.querySelector(`[data-id="${id}"] .nm-title`)!.textContent;
    expect(title('k2')).toBe('Shot 2 · Close-up');
    g.setParam('k2', 'framing', 'Insert');
    expect(title('k2')).toBe('Shot 2 · Insert');
    expect(title('ks')).toBe('Scene 1 · MORNING');
    expect(imgs().querySelectorAll('.dr-thumb')).toHaveLength(2);
    editor.destroy();
  });
});
