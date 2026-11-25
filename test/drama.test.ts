// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Evaluator, NodeEditor, dramaGraph, shotList, appearances, sceneInfo, getGraphType, seedanceScript, seedanceShot, seedancePack, type DramaStatus } from '../src/index';

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

/** Read a stored (uncompressed) zip: name → bytes. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; dv.getUint32(at, true) === 0x04034b50; ) {
    const size = dv.getUint32(at + 18, true);
    const nameLen = dv.getUint16(at + 26, true);
    const extra = dv.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extra;
    out.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}
const text = (b?: Uint8Array) => new TextDecoder().decode(b);

describe('Seedance export', () => {
  it('makes one generation per shot with images numbered in upload order', () => {
    const g = load('term');
    const shot = seedanceShot(g, 's1a');
    expect(shot.title).toBe('Ep 1 · Scene 1 · Shot 1');
    expect(shot.duration).toBe(8);
    expect(shot.refs.map((r) => r.path)).toEqual([
      'images/01-maya.jpg',
      'images/02-theo.jpg',
      'images/03-jules.jpg',
      'images/04-ms-okafor.jpg',
      'images/05-school-hall.jpg',
      'images/06-shot-1-frame.jpg',
      'images/07-school-hall.jpg',
    ]);
    expect(shot.prompt).toContain('Maya is @Image1, stage manager');
    expect(shot.prompt).toContain('Setting: School hall (@Image5, @Image7), interior, day.');
    expect(shot.prompt).toContain('Shot (0–8 s): Wide shot, slow dolly-in.');
    expect(shot.prompt).toContain('Match the composition of @Image6.');
    expect(shot.prompt).toContain('35mm film look'); // the season's style
    expect(shot.markdown).toMatch(/^# Ep 1 · Scene 1 · Shot 1: Seedance shot/);
    expect(shot.markdown).toContain('| @Image1 | ![Maya (character)](images/01-maya.jpg)');
  });

  it('writes a root script that points at each shot pack', () => {
    const g = load('term');
    const ep = seedanceScript(g, 'ep1');
    expect(ep.kind).toBe('episode');
    expect(ep.rootFile).toBe('script.md');
    expect(ep.shots.map((s) => s.zipPath)).toEqual([
      'shots/01-scene-1-shot-1.zip',
      'shots/02-scene-1-shot-2.zip',
      'shots/03-scene-1-shot-3.zip',
      'shots/04-scene-2-shot-1.zip',
      'shots/05-scene-2-shot-2.zip',
      'shots/06-scene-3-shot-1.zip',
      'shots/07-scene-3-shot-2.zip',
    ]);
    expect(ep.markdown).toContain('| 1 · Wide | `shots/01-scene-1-shot-1.zip` | 8 s | 7 | Maya, Theo, Jules, Ms Okafor |');
    expect(ep.markdown).toContain('#### Shot 2 · 4 s · `shots/02-scene-1-shot-2.zip`');
    const scene = seedanceScript(g, 'sc2');
    expect(scene.rootFile).toBe('scene.md');
    expect(scene.shots[0].zipPath).toBe('shots/01-shot-1.zip');
    expect(seedanceScript(g, 'season').shots[0].zipPath).toBe('shots/01-ep-1-scene-1-shot-1.zip');
    expect(seedanceScript(g, 's2b').rootFile).toBe('shot.md');
  });

  it('caps reference images and notes long shots', () => {
    const g = load('scene');
    for (let i = 0; i < 9; i++) {
      const c = g.addNode('drama/character', { id: `c${i}`, params: { images: [`data:image/png;base64,QUJD${i}`] } });
      g.connect({ node: c.id, port: 'appears' }, { node: 'k1', port: 'characters' });
    }
    g.setParam('k1', 'duration', 22);
    const shot = seedanceShot(g, 'k1');
    expect(shot.refs).toHaveLength(9);
    expect(shot.dropped.length).toBeGreaterThan(0);
    expect(shot.duration).toBe(15);
    expect(shot.markdown).toContain('Left out (this script allows 9 images per clip');
    expect(shot.markdown).toContain('so it is cut');
  });

  it('takes the image cap and clip length from the episode, then the season', () => {
    const g = load('scene');
    for (let i = 0; i < 12; i++) {
      const c = g.addNode('drama/character', { id: `c${i}`, params: { images: [`data:image/png;base64,QUJD${i}`] } });
      g.connect({ node: c.id, port: 'appears' }, { node: 'k1', port: 'characters' });
    }
    g.setParam('k1', 'duration', 25);
    g.addNode('drama/episode', { id: 'ep' });
    g.addNode('drama/season', { id: 'se', params: { maxImages: 20, maxClip: 30 } });
    g.connect({ node: 'ks', port: 'episode' }, { node: 'ep', port: 'scenes' });
    g.connect({ node: 'ep', port: 'season' }, { node: 'se', port: 'episodes' });
    let shot = seedanceShot(g, 'k1');
    expect(shot.refs.length).toBeGreaterThan(12);
    expect(shot.duration).toBe(25);
    g.setParam('ep', 'maxImages', 5);
    shot = seedanceShot(g, 'k1');
    expect(shot.refs).toHaveLength(5);
  });

  it('packs a shot as shot.md plus its images', async () => {
    const g = load('scene');
    g.setParam('a', 'images', ['data:image/png;base64,iVBORw0KGgo=']);
    const { filename, blob } = await seedancePack(g, 'k1');
    expect(filename).toBe('scene-1-shot-1-seedance.zip');
    const files = unzip(new Uint8Array(await blob.arrayBuffer()));
    expect([...files.keys()]).toEqual(['shot.md', 'images/01-ana.png', 'images/02-ben.svg', 'images/03-shot-1-frame.svg']);
    // Without a canvas, SVG sketches go in as SVG and shot.md points at them.
    expect(text(files.get('shot.md'))).toContain('images/02-ben.svg');
    expect([...files.get('images/01-ana.png')!.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('packs a scene as scene.md, a zip per shot and the storyboard', async () => {
    const g = load('scene');
    g.setParam('ks', 'storyboard', ['data:image/png;base64,iVBORw0KGgo=']);
    const { filename, blob, script } = await seedancePack(g, 'ks');
    expect(filename).toBe('scene-1-seedance.zip');
    const files = unzip(new Uint8Array(await blob.arrayBuffer()));
    expect([...files.keys()]).toEqual(['scene.md', 'shots/01-shot-1.zip', 'shots/02-shot-2.zip', 'storyboard/scene-1-01.png']);
    expect(script.markdown).toContain('![Scene 1 storyboard 1](storyboard/scene-1-01.png)');
    const inner = unzip(files.get('shots/02-shot-2.zip')!);
    expect(inner.has('shot.md')).toBe(true);
    expect(text(inner.get('shot.md'))).toContain('Shot (0–4 s): Close-up');
  });

  it('packs an episode as script.md and its shot zips', async () => {
    const g = load('term');
    const files = unzip(new Uint8Array(await (await seedancePack(g, 'ep2')).blob.arrayBuffer()));
    expect([...files.keys()]).toEqual(['script.md', 'shots/01-scene-1-shot-1.zip', 'shots/02-scene-1-shot-2.zip', 'shots/03-scene-1-shot-3.zip']);
    expect(text(files.get('script.md'))).toMatch(/^# Opening Night: Seedance script/);
  });
});

describe('Appearance and costumes', () => {
  it('repeats appearance word for word and dresses characters per scene', () => {
    const g = load('term');
    // Opening night: Jules wears the lead costume, and its picture goes in right after the characters.
    const s4c = seedanceShot(g, 's4c');
    expect(s4c.refs.map((r) => r.path).slice(0, 2)).toEqual(['images/01-jules.jpg', 'images/02-jules-costume.jpg']);
    expect(s4c.prompt).toContain(
      '- Jules is @Image1, the understudy who knows every line of every part. Appearance: 16, small and quick, light brown skin, blonde bob with a fringe. Purple cardigan over a striped top. Costume in this scene: Deep green velvet frock coat with gold buttons, white ruffled shirt, black breeches, buckled shoes (@Image2); it replaces their usual clothes.',
    );
    expect(s4c.prompt).toContain('their clothes consistent with their costume');
    // Scene 1 has no costumes: usual clothes, same appearance text.
    const s1c = seedanceShot(g, 's1c');
    expect(s1c.prompt).toContain('Appearance: 16, small and quick, light brown skin, blonde bob with a fringe. Purple cardigan over a striped top.');
    expect(s1c.prompt).not.toContain('Costume in this scene');
    expect(s1c.refs.some((r) => r.path.includes('costume'))).toBe(false);
    // The script lists the scene's costumes and everyone's appearance.
    const script = seedanceScript(g, 'ep2').markdown;
    expect(script).toContain('**Costumes:** Jules: Deep green velvet frock coat');
    expect(script).toContain('Appearance: Early 20s, slim, warm brown skin');
    expect(shotList(g, 'sc4')).toContain('Costume, Maya: All-black crew clothes');
  });

  it('flags costumes that cannot apply', async () => {
    const g = load('term');
    g.addNode('drama/costume', { id: 'spare', params: { description: 'Second coat' } });
    g.connect({ node: 'jules', port: 'appears' }, { node: 'spare', port: 'character' });
    g.connect({ node: 'spare', port: 'scenes' }, { node: 'sc4', port: 'costumes' });
    g.addNode('drama/costume', { id: 'nobody' });
    g.addNode('drama/costume', { id: 'teacher' });
    g.connect({ node: 'okafor', port: 'appears' }, { node: 'teacher', port: 'character' });
    g.connect({ node: 'teacher', port: 'scenes' }, { node: 'sc4', port: 'costumes' });
    const r = await run(g);
    expect(st(r, 'sc4').warnings).toEqual(['Two costumes for Jules', 'Ms Okafor has a costume but isn’t in any shot']);
    expect(st(r, 'nobody').warnings).toEqual(['Not linked to a character']);
    expect(st(r, 'jules-lead').line).toBe('Jules · 1 scene');
    // The first costume wired in wins.
    expect(seedanceShot(g, 's4c').prompt).toContain('Deep green velvet');
  });
});
