// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Graph, NodeEditor, dramaGraph, drama2Graph, dramaImagePrompt, meshyImageGenerator, setImageGenerator, type ImageGenerator } from '../src/index';

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

  it('is not offered without a generator', () => {
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    expect(el.querySelector('.dr-gen')).toBeNull();
    editor.destroy();
  });
});
