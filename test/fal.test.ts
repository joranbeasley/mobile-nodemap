// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  Graph,
  NodeEditor,
  drama2Graph,
  toDrama,
  seedanceShot,
  falVideoGenerator,
  falImageGenerator,
  setVideoGenerators,
  setImageGenerators,
  shotClipSuggestion,
  FAL_VIDEO_MODELS,
  type VideoGenerator,
  type VideoRequest,
  type ImageGenerator,
} from '../src/index';

afterEach(() => {
  setVideoGenerators([]);
  setImageGenerators([]);
  localStorage.clear();
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A stand-in for fal: the queue (submit, status, result) and storage uploads. */
function fakeFal(output: Record<string, unknown>, opts: { statusUrls?: boolean; fail?: { status: number; body: unknown } } = {}) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  let polls = 0;
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['x'], { type: 'image/png' }) }) as unknown as Response;
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body });
    if (url.startsWith('data:')) return json({});
    if (url.includes('/storage/upload/initiate')) return json({ upload_url: 'https://upload.test/put/1', file_url: `https://v3.fal.media/files/up-${calls.length}.png` });
    if (url.startsWith('https://upload.test/')) return json({});
    if (opts.fail && init.method === 'POST') return json(opts.fail.body, opts.fail.status);
    if (init.method === 'POST')
      return json({ request_id: 'req-1', ...(opts.statusUrls ? { status_url: 'https://queue.fal.run/x/y/requests/req-1/status', response_url: 'https://queue.fal.run/x/y/requests/req-1' } : {}) });
    if (url.endsWith('/status')) return json(++polls < 2 ? { status: 'IN_QUEUE', queue_position: 2 } : { status: 'COMPLETED' });
    return json(output);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch, posts: () => calls.filter((c) => c.method === 'POST' && c.url.startsWith('https://queue.fal.run')) };
}

describe('fal video (Seedance)', () => {
  it('sends reference pictures to reference-to-video, uploading what fal can’t fetch', async () => {
    const fal = fakeFal({ video: { url: 'https://v3.fal.media/files/clip.mp4' } });
    const gen = falVideoGenerator({ apiKey: 'k-1', fetch: fal.fetch, pollMs: 1 });
    expect(gen.models.map((m) => m.id)).toEqual(FAL_VIDEO_MODELS.map((m) => m.id));
    const progress: string[] = [];
    const res = await gen.generate({
      prompt: 'Theo (@Image1) in the hall (@Image2)',
      references: ['data:image/png;base64,QUJD', 'https://cdn.test/hall.jpg'],
      duration: 7.4,
      aspect: '16:9',
      resolution: '1080p', // Fast stops at 720p
      model: 'seedance-2.0-fast',
      onProgress: (t) => progress.push(t),
    });
    expect(res).toEqual({ videos: ['https://v3.fal.media/files/clip.mp4'] });
    const [submit] = fal.posts();
    expect(submit.url).toBe('https://queue.fal.run/bytedance/seedance-2.0/fast/reference-to-video');
    expect(submit.headers.Authorization).toBe('Key k-1');
    expect(submit.body).toEqual({
      prompt: 'Theo (@Image1) in the hall (@Image2)',
      duration: '7',
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: false,
      image_urls: [expect.stringMatching(/^https:\/\/v3\.fal\.media\/files\/up-/), 'https://cdn.test/hall.jpg'],
    });
    // The data: picture went through fal storage (initiate, then PUT without the key).
    const init = fal.calls.find((c) => c.url.includes('/storage/upload/initiate'))!;
    expect(init.url).toBe('https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3');
    expect(init.body).toMatchObject({ content_type: 'image/png' });
    const put = fal.calls.find((c) => c.url.startsWith('https://upload.test/'))!;
    expect(put.method).toBe('PUT');
    expect(put.headers.Authorization).toBeUndefined();
    // Status and result live under owner/alias.
    expect(fal.calls.some((c) => c.url === 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-1/status')).toBe(true);
    expect(fal.calls.some((c) => c.url === 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-1')).toBe(true);
    expect(progress).toContain("In fal's queue (2 ahead)…");
  });

  it('starts from a first frame (image-to-video), or from text alone', async () => {
    const fal = fakeFal({ video: { url: 'https://v/c.mp4' } }, { statusUrls: true });
    const gen = falVideoGenerator({ apiKey: 'k', fetch: fal.fetch, pollMs: 1 });
    await gen.generate({ prompt: 'carry on', firstFrame: 'https://cdn.test/end.jpg', duration: 40, aspect: '2.39:1', model: 'seedance-2.5', audio: true });
    await gen.generate({ prompt: 'just words', duration: 2 });
    const [a, b] = fal.posts();
    expect(a.url).toBe('https://queue.fal.run/bytedance/seedance-2.5/us/image-to-video');
    expect(a.body).toMatchObject({ image_url: 'https://cdn.test/end.jpg', duration: '30', aspect_ratio: '21:9', generate_audio: true }); // 2.5 goes to 30 s; nearest ratio
    expect(b.url).toBe('https://queue.fal.run/bytedance/seedance-2.0/fast/text-to-video'); // the default model
    expect(b.body).toMatchObject({ prompt: 'just words', duration: '4' });
    // The status URL fal returned is the one polled.
    expect(fal.calls.some((c) => c.url === 'https://queue.fal.run/x/y/requests/req-1/status')).toBe(true);
  });

  it('estimates from fal’s listed prices: model, resolution and length decide it', () => {
    const gen = falVideoGenerator({ apiKey: 'k' });
    expect(gen.estimate!({ model: 'seedance-2.0-mini', duration: 5, resolution: '480p' })).toEqual({ amount: 0.36, unit: 'USD', basis: "fal's listed price" });
    expect(gen.estimate!({ model: 'seedance-2.0', duration: 7, resolution: '720p' })!.amount).toBe(2.12); // 7 × $0.3024
    expect(gen.estimate!({ model: 'seedance-2.0-fast', duration: 10, resolution: '1080p' })!.amount).toBe(2.42); // Fast stops at 720p
    expect(gen.estimate!({ model: 'seedance-2.5', duration: 40, resolution: '1080p' })!.amount).toBe(34.92); // 30 s at most
    expect(gen.estimate!({ model: 'nope' })).toBeUndefined();
  });

  it('explains failures', async () => {
    await expect(falVideoGenerator({ fetch: fakeFal({}).fetch }).generate({ prompt: 'x' })).rejects.toThrow('Add your fal API key first');
    const bad = (status: number, body: unknown) => falVideoGenerator({ apiKey: 'k', fetch: fakeFal({}, { fail: { status, body } }).fetch }).generate({ prompt: 'x' });
    await expect(bad(401, {})).rejects.toThrow('fal said 401: check your API key');
    await expect(bad(422, { detail: [{ loc: ['body', 'duration'], msg: 'unexpected value' }] })).rejects.toThrow('duration: unexpected value');
    await expect(bad(403, { detail: 'User is locked. Reason: Exhausted balance.' })).rejects.toThrow('Exhausted balance');
    const empty = falVideoGenerator({ apiKey: 'k', fetch: fakeFal({ video: {} }).fetch, pollMs: 1 });
    await expect(empty.generate({ prompt: 'x' })).rejects.toThrow('fal returned no clip');
  });
});

describe('fal pictures (Nano Banana)', () => {
  it('generates from text, or edits with reference pictures', async () => {
    const fal = fakeFal({ images: [{ url: 'https://v/p.png' }] });
    const gen = falImageGenerator({ apiKey: 'k', fetch: fal.fetch, pollMs: 1 });
    expect(await gen.generate({ prompt: 'a red door', aspect: '3:4' })).toEqual({ images: ['https://v/p.png'] });
    await gen.generate({ prompt: 'Theo in the hall', references: ['https://cdn.test/theo.jpg'], model: 'fal-ai/nano-banana-pro', aspect: '7:3' });
    const [a, b] = fal.posts();
    expect(a.url).toBe('https://queue.fal.run/fal-ai/nano-banana-2');
    expect(a.body).toEqual({ prompt: 'a red door', num_images: 1, aspect_ratio: '3:4' });
    expect(b.url).toBe('https://queue.fal.run/fal-ai/nano-banana-pro/edit');
    expect(b.body).toMatchObject({ image_urls: ['https://cdn.test/theo.jpg'], aspect_ratio: '21:9' });
    expect(fal.calls.some((c) => c.url === 'https://queue.fal.run/fal-ai/nano-banana-pro/requests/req-1/status')).toBe(true);
  });

  it('estimates a picture at fal’s listed price', async () => {
    const gen = falImageGenerator({ apiKey: 'k' });
    expect(await gen.estimate!({ model: 'fal-ai/nano-banana-2' })).toEqual({ credits: 0.08, unit: 'USD', basis: "fal's listed price" });
    expect((await gen.estimate!({ model: 'fal-ai/nano-banana-pro', references: 2 }))!.credits).toBe(0.15);
  });
});

describe('🎬 Generate clip on a shot', () => {
  const mount = () => {
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    for (const n of g.nodes.values()) if (Array.isArray(n.params.images) && n.params.images.length) g.setParam(n.id, 'images', [`data:image/png;base64,${btoa(n.id)}`]);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    return { g, el, editor };
  };

  it('starts from the shot’s Seedance prompt and pictures, and keeps the clip', async () => {
    let asked: VideoRequest | undefined;
    const fake: VideoGenerator = {
      id: 'fake',
      name: 'Fakeclip',
      models: [{ id: 'm', label: 'Model', minDuration: 4, maxDuration: 15, aspects: ['16:9', '9:16'], resolutions: ['480p', '720p'], audio: true }],
      defaultModel: 'm',
      async generate(req) {
        asked = req;
        req.onProgress?.('Generating…');
        return { videos: ['https://v/clip.mp4'], cost: '$0.70' };
      },
    };
    setVideoGenerators([fake]);
    // Downloading the clip (for its last frame) fails here, as it would where the host blocks it.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const { g, el, editor } = mount();
    await editor.setView('shots');
    const field = () => el.querySelector<HTMLElement>('.nm-node[data-id="s1b"] [data-param="lastFrame"]')!;
    const gen = [...field().querySelectorAll('button')].find((b) => b.textContent === '🎬 Generate clip')!;
    gen.click();
    const panel = field().querySelector<HTMLElement>('.dr-clip-panel')!;
    const expected = seedanceShot(toDrama(g), 's1b');
    expect(panel.querySelector('textarea')!.value).toBe(expected.prompt);
    expect([...panel.querySelectorAll('.dr-gen-ref')].map((b) => b.getAttribute('aria-label'))).toEqual(expected.refs.map((r) => r.label));
    expect(panel.querySelector<HTMLInputElement>('input[aria-label="Seconds"]')!.value).toBe(String(expected.duration));
    panel.querySelector<HTMLInputElement>('input[aria-label="With sound"]')!.checked = true;
    expect(panel.querySelector('.dr-gen-cost')!.textContent).toBe(''); // this fake has no prices
    panel.querySelector<HTMLButtonElement>('.dr-gen-go')!.click();
    await tick(30);
    expect(asked).toMatchObject({ prompt: expected.prompt, references: expected.refs.map((r) => r.src), duration: expected.duration, aspect: '16:9', resolution: '720p', model: 'm', audio: true });
    expect(g.nodes.get('s1b')!.params.clipUrl).toBe('https://v/clip.mp4');
    // happy-dom can't decode video: the field says what to do instead, and links the clip.
    expect(field().querySelector('.dr-clip-panel')).toBeNull();
    expect(field().querySelector<HTMLAnchorElement>('.dr-clip-watch')!.href).toBe('https://v/clip.mp4');
    expect(field().textContent).toMatch(/Clip ready · \$0\.70\. Its last frame couldn’t be taken here/);
    globalThis.fetch = realFetch;
    editor.destroy();
  });

  it('starts a continuing shot from the previous clip’s last frame', () => {
    const { g, editor } = mount();
    g.setParam('s1a', 'lastFrame', 'data:image/jpeg;base64,RU5E');
    g.setParam('s1b', 'continues', true);
    const s = shotClipSuggestion(toDrama(g), 's1b')!;
    expect(s.firstFrame).toBe('data:image/jpeg;base64,RU5E');
    expect(s.references[0].src).toBe(s.firstFrame);
    editor.destroy();
  });

  it('offers a choice of services, remembering the last one', async () => {
    const make = (id: string): ImageGenerator => ({ id, name: id.toUpperCase(), async generate() {
      return { images: [] };
    } });
    setImageGenerators([make('meshy'), make('fal')]);
    const { el, editor } = mount();
    const field = () => el.querySelector<HTMLElement>('.nm-node[data-id="theo"] [data-param="images"]')!;
    field().querySelector<HTMLButtonElement>('.dr-gen')!.click();
    const service = () => field().querySelector<HTMLSelectElement>('.dr-gen-panel select[aria-label="Service"]')!;
    expect([...service().options].map((o) => o.textContent)).toEqual(['MESHY', 'FAL']);
    service().value = 'fal';
    service().dispatchEvent(new Event('change'));
    expect(field().querySelector('.dr-gen-panel')!.getAttribute('aria-label')).toBe('Generate an image with FAL');
    expect(localStorage.getItem('nodemap:image-generator')).toBe('fal');
    editor.destroy();
  });
});

describe('🎬 price in the clip panel', () => {
  it('shows fal’s price for the settings, and follows them', async () => {
    setVideoGenerators([falVideoGenerator({ apiKey: 'k' })]);
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    await editor.setView('shots');
    const field = el.querySelector<HTMLElement>('.nm-node[data-id="s1b"] [data-param="lastFrame"]')!;
    [...field.querySelectorAll('button')].find((b) => b.textContent === '🎬 Generate clip')!.click();
    const panel = field.querySelector<HTMLElement>('.dr-clip-panel')!;
    const set = (sel: string, v: string) => {
      const x = panel.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
      x.value = v;
      x.dispatchEvent(new Event('change'));
    };
    const price = () => panel.querySelector('.dr-gen-cost')!.textContent;
    set('select[aria-label="Model"]', 'seedance-2.0-mini');
    set('input[aria-label="Seconds"]', '5');
    set('select[aria-label="Resolution"]', '480p');
    expect(price()).toBe("About $0.36 for 5 s at 480p (fal's listed price)");
    set('select[aria-label="Resolution"]', '720p');
    expect(price()).toBe("About $0.77 for 5 s at 720p (fal's listed price)");
    editor.destroy();
  });
});
