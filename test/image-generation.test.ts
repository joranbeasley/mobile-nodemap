// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Graph, NodeEditor, dramaGraph, drama2Graph, dramaImagePrompt, dramaImageReferences, meshyImageGenerator, setImageGenerator, type ImageGenerator } from '../src/index';

afterEach(() => setImageGenerator(null));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('Meshy image generator', () => {
  it('creates a text-to-image task, polls it and returns its pictures', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let polls = 0;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
      if (init?.method === 'POST') return json({ result: 'task-1' });
      polls++;
      return polls < 2 ? json({ status: 'IN_PROGRESS', progress: 40 }) : json({ status: 'SUCCEEDED', progress: 100, image_urls: ['https://assets.example/x.png'], consumed_credits: 9 });
    }) as unknown as typeof fetch;
    const gen = meshyImageGenerator({ apiKey: 'k-123', fetch: fakeFetch, pollMs: 1 });
    const progress: number[] = [];
    const res = await gen.generate({ prompt: 'a red door', aspect: '21:9', model: 'nano-banana-pro', onProgress: (p) => progress.push(p) });
    expect(res).toEqual({ images: ['https://assets.example/x.png'], credits: 9 });
    expect(calls[0].url).toBe('https://api.meshy.ai/openapi/v1/text-to-image');
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ ai_model: 'nano-banana-pro', prompt: 'a red door', aspect_ratio: '16:9' }); // 21:9 → nearest allowed
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer k-123');
    expect(calls[1].url).toBe('https://api.meshy.ai/openapi/v1/text-to-image/task-1');
    expect(progress).toEqual([40, 100]);
  });

  it('sends reference pictures to image-to-image (up to 5) and polls that task', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
      return init?.method === 'POST' ? json({ result: 'task-2' }) : json({ status: 'SUCCEEDED', progress: 100, image_urls: ['https://assets.example/y.png'], consumed_credits: 3 });
    }) as unknown as typeof fetch;
    const gen = meshyImageGenerator({ apiKey: 'k', fetch: fakeFetch, pollMs: 1 });
    expect(gen.maxReferences).toBe(5);
    const refs = ['https://a/1.png', 'data:image/jpeg;base64,AAA', 'https://a/3.png', 'https://a/4.png', 'https://a/5.png', 'https://a/6.png'];
    const res = await gen.generate({ prompt: 'Theo on stage', aspect: '16:9', references: refs });
    expect(res).toEqual({ images: ['https://assets.example/y.png'], credits: 3 });
    expect(calls[0].url).toBe('https://api.meshy.ai/openapi/v1/image-to-image');
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ ai_model: 'nano-banana', prompt: 'Theo on stage', aspect_ratio: '16:9', reference_image_urls: refs.slice(0, 5) });
    expect(calls[1].url).toBe('https://api.meshy.ai/openapi/v1/image-to-image/task-2');
    // No references: plain text-to-image.
    await gen.generate({ prompt: 'x', references: [] });
    expect(calls[2].url).toBe('https://api.meshy.ai/openapi/v1/text-to-image');
  });

  it('explains failures', async () => {
    const noKey = meshyImageGenerator({ fetch: (async () => ({})) as unknown as typeof fetch });
    await expect(noKey.generate({ prompt: 'x' })).rejects.toThrow(/API key/);
    const bad = meshyImageGenerator({ apiKey: 'k', fetch: (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch });
    await expect(bad.generate({ prompt: 'x' })).rejects.toThrow(/check your API key/);
    let n = 0;
    const failed = meshyImageGenerator({
      apiKey: 'k',
      pollMs: 1,
      fetch: (async () => ({ ok: true, status: 200, json: async () => (n++ ? { status: 'FAILED', task_error: { message: 'Prompt blocked' } } : { result: 't' }) })) as unknown as typeof fetch,
    });
    await expect(failed.generate({ prompt: 'x' })).rejects.toThrow('Prompt blocked');
  });
});

describe('Image prompts from drama cards', () => {
  it('writes a reference portrait for a character and a storyboard frame for a shot', () => {
    const g = Graph.fromJSON(dramaGraph.examples![0].graph, dramaGraph.createRegistry());
    const maya = dramaImagePrompt(g, g.nodes.get('maya')!)!;
    expect(maya.aspect).toBe('3:4');
    expect(maya.prompt).toMatch(/^Character reference portrait of Maya\. Early 20s, slim, warm brown skin/);
    const shot = dramaImagePrompt(g, g.nodes.get('s1b')!)!;
    expect(shot.aspect).toBe('16:9');
    expect(shot.prompt).toContain('Storyboard frame, close-up shot. Theo freezes on his first line.');
    expect(shot.prompt).toContain('On screen: Theo: 17, tall and lanky');
    expect(shot.prompt).toContain('Setting: School hall, interior, day.');
    expect(shot.prompt).toContain('35mm film look'); // the season's style
    expect(dramaImagePrompt(g, g.nodes.get('jules-lead')!)!.prompt).toMatch(/^Costume reference: Deep green velvet.* Worn by Jules: 16/);
  });

  it('suggests reference pictures: who is in a shot, where, and what they wear', () => {
    const g = Graph.fromJSON(dramaGraph.examples![0].graph, dramaGraph.createRegistry());
    const first = (id: string) => (g.nodes.get(id)!.params.images as string[])[0];
    const shot = dramaImageReferences(g, g.nodes.get('s1b')!);
    expect(shot[0]).toEqual({ src: first('theo'), label: 'Theo' });
    expect(shot.map((r) => r.label)).toContain('School hall (location)');
    expect(dramaImagePrompt(g, g.nodes.get('s1b')!)!.references).toEqual(shot);
    // A costume: its wearer. A character: nothing to match yet.
    expect(dramaImageReferences(g, g.nodes.get('jules-lead')!)).toEqual([{ src: first('jules'), label: 'Jules' }]);
    expect(dramaImageReferences(g, g.nodes.get('maya')!)).toEqual([]);
    // Scenes: their cast and places, each picture once.
    const scene = dramaImageReferences(g, g.nodes.get('sc1')!);
    expect(new Set(scene.map((r) => r.src)).size).toBe(scene.length);
  });
});

describe('✨ Generate in image fields', () => {
  it('opens a prompt from the card, asks for a key once, and adds the picture', async () => {
    let asked: { prompt: string; aspect?: string } | undefined;
    let key = '';
    const fake: ImageGenerator = {
      id: 'fake',
      name: 'Fakeshy',
      models: [{ id: 'm1', label: 'Model 1' }],
      defaultModel: 'm1',
      key: { label: 'Fake key', get: () => key, set: (v) => (key = v) },
      async generate(req) {
        asked = req;
        req.onProgress?.(50);
        return { images: ['data:image/png;base64,QUJD'], credits: 4 };
      },
    };
    setImageGenerator(fake);
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    const field = () => el.querySelector<HTMLElement>('.nm-node[data-id="theo"] [data-param="images"]')!;
    field().querySelector<HTMLButtonElement>('.dr-gen')!.click();
    const panel = field().querySelector<HTMLElement>('.dr-gen-panel')!;
    expect(panel.querySelector('textarea')!.value).toMatch(/^Character reference portrait of Theo\. 17, tall and lanky/);
    expect(panel.querySelector<HTMLSelectElement>('select[aria-label="Aspect ratio"]')!.value).toBe('3:4');
    // No key yet: the panel asks for it.
    const go = panel.querySelector<HTMLButtonElement>('.dr-gen-go')!;
    go.click();
    await tick();
    expect(panel.querySelector('.dr-gen-status')!.textContent).toMatch(/Add your Fake key/);
    panel.querySelector<HTMLInputElement>('.dr-gen-key input')!.value = 'secret';
    go.click();
    await tick(30);
    expect(key).toBe('secret');
    expect(asked).toMatchObject({ aspect: '3:4' });
    const images = g.nodes.get('theo')!.params.images as string[];
    expect(images).toHaveLength(2);
    expect(field().querySelector('.dr-gen-panel')).toBeNull();
    expect(field().querySelector('.dr-gen-note')!.textContent).toMatch(/Added 1 from Fakeshy · 4 credits/);
    editor.destroy();
  });

  it('sends the chosen reference pictures, in order, and names them in the prompt', async () => {
    let asked: { prompt: string; references?: string[] } | undefined;
    setImageGenerator({
      id: 'fake',
      name: 'Fakeshy',
      maxReferences: 2,
      async generate(req) {
        asked = req;
        return { images: ['data:image/png;base64,QUJD'] };
      },
    });
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    // Photos (PNG) on every card, so they go as they are.
    for (const n of g.nodes.values()) if (Array.isArray(n.params.images) && n.params.images.length) g.setParam(n.id, 'images', [`data:image/png;base64,${btoa(n.id)}`]);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    const field = () => el.querySelector<HTMLElement>('.nm-node[data-id="s1b"] [data-param="images"]')!;
    field().querySelector<HTMLButtonElement>('.dr-gen')!.click();
    const panel = field().querySelector<HTMLElement>('.dr-gen-panel')!;
    const refs = [...panel.querySelectorAll<HTMLButtonElement>('.dr-gen-ref')];
    expect(refs[0].getAttribute('aria-label')).toBe('Theo');
    // The limit (2) are on; the rest, and the card's own picture, are off.
    expect(refs.map((r) => r.getAttribute('aria-pressed'))).toEqual(refs.map((_, i) => String(i < 2)));
    expect(refs.at(-1)!.getAttribute('aria-label')).toBe('This card’s picture 1');
    expect(panel.querySelector('.dr-gen-refs-note')!.textContent).toMatch(/^2 reference pictures/);
    // A third can't go on until one is off.
    refs[2].click();
    expect(refs[2].getAttribute('aria-pressed')).toBe('false');
    expect(panel.querySelector('.dr-gen-status')!.textContent).toMatch(/up to 2 reference pictures/);
    refs[1].click();
    refs[2].click();
    panel.querySelector<HTMLButtonElement>('.dr-gen-go')!.click();
    await tick(30);
    const label = (b: HTMLButtonElement) => b.getAttribute('aria-label');
    expect(asked!.references).toEqual([refs[0], refs[2]].map((b) => b.querySelector('img')!.getAttribute('src')));
    expect(asked!.prompt).toMatch(new RegExp(`Reference pictures, in order: 1\\. ${label(refs[0])}; 2\\. ${label(refs[2])!.replace(/[()]/g, '\\$&')}\\.`));
    editor.destroy();
  });

  it('is not offered without a generator', () => {
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    expect(el.querySelector('.dr-gen')).toBeNull();
    editor.destroy();
  });
});

describe('Searching existing assets', () => {
  it('lists pictures and 3D model thumbnails from Meshy, newest first', async () => {
    const rows: Record<string, unknown[]> = {
      '/openapi/v1/text-to-image': [{ id: 'i1', status: 'SUCCEEDED', prompt: 'a brass key', image_urls: ['https://a/key.png'], created_at: 2 }],
      '/openapi/v2/text-to-3d': [{ id: 'm1', status: 'SUCCEEDED', prompt: 'old wooden chair', thumbnail_url: 'https://a/chair.png', created_at: 3 }],
      '/openapi/v1/image-to-3d': [{ id: 'm2', status: 'FAILED', name: 'broken', thumbnail_url: 'https://a/x.png', created_at: 4 }],
      '/openapi/v1/multi-image-to-3d': [],
    };
    const seen: string[] = [];
    const gen = meshyImageGenerator({
      apiKey: 'k',
      fetch: (async (url: string) => {
        seen.push(url);
        const path = new URL(url).pathname;
        return { ok: true, status: 200, json: async () => rows[path] ?? [] };
      }) as unknown as typeof fetch,
    });
    const assets = await gen.browse!();
    expect(assets.map((a) => [a.label, a.hint?.split(' · ')[0], a.url])).toEqual([
      ['old wooden chair', '3D model', 'https://a/chair.png'],
      ['a brass key', 'Picture', 'https://a/key.png'],
    ]);
    expect(seen.every((u) => u.includes('page_size=50') && u.includes('sort_order=desc'))).toBe(true);
  });

  it('offers 🔍 on prop pictures and adds the chosen one', async () => {
    const fake: ImageGenerator = {
      id: 'fake',
      name: 'Fakeshy',
      key: { label: 'Fake key', get: () => 'k', set: () => {} },
      generate: async () => ({ images: [] }),
      browse: async () => [{ id: 'a1', label: 'Dog-eared script', hint: 'Picture', thumb: 'data:image/png;base64,QUJD', url: 'data:image/png;base64,QUJD' }],
    };
    setImageGenerator(fake);
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    await editor.setView('props');
    expect(el.querySelector('.nm-node[data-id="theo"] .dr-browse')).toBeNull(); // characters don't get it
    el.querySelector<HTMLButtonElement>('.nm-node[data-id="script"] .dr-browse')!.click();
    await tick(10);
    const sheet = document.querySelector<HTMLElement>('.nm-choose')!;
    expect(sheet.querySelector('.nm-choose-thumb')).toBeTruthy();
    await tick(360);
    sheet.querySelector<HTMLButtonElement>('.nm-sheet-item')!.click();
    await tick(30);
    expect(g.nodes.get('script')!.params.images as string[]).toHaveLength(2);
    expect(el.querySelector('.nm-node[data-id="script"] .dr-gen-note')!.textContent).toBe('Added from Fakeshy');
    editor.destroy();
  });
});

describe('When the page cannot reach Meshy', () => {
  it('says so plainly instead of "Failed to fetch"', async () => {
    const gen = meshyImageGenerator({
      apiKey: 'k',
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    await expect(gen.generate({ prompt: 'x' })).rejects.toThrow(/can't reach Meshy.*Copy the prompt/);
    expect(gen.site).toBe('https://www.meshy.ai/');
  });
});

describe('Entering the API key', () => {
  it('cleans pasted keys, saves them straight away and offers to change them later', async () => {
    let key = '';
    setImageGenerator({ id: 'f', name: 'Fakeshy', key: { label: 'Fake key', get: () => key, set: (v) => (key = v) }, generate: async () => ({ images: [] }) });
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    const field = () => el.querySelector<HTMLElement>('.nm-node[data-id="maya"] [data-param="images"]')!;
    field().querySelector<HTMLButtonElement>('.dr-gen')!.click();
    const input = field().querySelector<HTMLInputElement>('.dr-gen-key input')!;
    expect(input.type).toBe('text'); // not a password field: keyboards offer paste
    expect(input.classList.contains('dr-key-masked')).toBe(true);
    input.value = '  Bearer "msy_abc123"\n';
    input.dispatchEvent(new Event('input'));
    expect(key).toBe('msy_abc123');
    expect(input.value).toBe('msy_abc123');
    expect(field().querySelector('.dr-gen-status')!.textContent).toMatch(/saved in this browser/);
    // Show / Hide
    const show = [...field().querySelectorAll<HTMLButtonElement>('.dr-gen-key button')].find((b) => b.textContent === 'Show')!;
    show.click();
    expect(input.classList.contains('dr-key-masked')).toBe(false);
    // Reopened later: the key is saved, so it offers to change it instead of asking.
    [...field().querySelectorAll<HTMLButtonElement>('.dr-gen-cancel')].find((b) => b.textContent === 'Cancel')!.click();
    field().querySelector<HTMLButtonElement>('.dr-gen')!.click();
    expect(field().querySelector('.dr-gen-key input')).toBeNull();
    expect(field().querySelector('.dr-gen-link-btn')!.textContent).toBe('Change Fake key');
    editor.destroy();
  });
});
