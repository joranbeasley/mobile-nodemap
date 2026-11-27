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
  dramaImageReferences,
  setClipKeeper,
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
/** Open a node's Edit sheet (cards are summaries; the sheet has every field), past its guard against the opening tap. */
const openSheet = async (editor: NodeEditor, id: string) => {
  editor.openNodeEditor(id);
  await tick(360);
};
/** A field in the open Edit sheet. */
const inSheet = (name: string) => [...document.querySelectorAll<HTMLElement>('.nm-edit')].pop()!.querySelector<HTMLElement>(`[data-param="${name}"]`)!;
/** A field on a node's card (a shot's clip shows there once it has one, or one is on its way). */
const onCard = (el: HTMLElement, id: string, name: string) => el.querySelector<HTMLElement>(`.nm-node[data-id="${id}"] [data-param="${name}"]`)!;

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

  it('runs Kling, Veo, Wan and MiniMax with each one’s own inputs', async () => {
    const fal = fakeFal({ video: { url: 'https://v/c.mp4' } });
    const gen = falVideoGenerator({ apiKey: 'k', fetch: fal.fetch, pollMs: 1 });
    const refs = ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg', 'https://cdn.test/3.jpg', 'https://cdn.test/4.jpg', 'https://cdn.test/5.jpg'];
    // Kling O3: @Image1… like Seedance, up to 4.
    await gen.generate({ prompt: 'Theo (@Image1)', references: refs, duration: 20, aspect: '4:3', model: 'kling-o3-pro', audio: true });
    // Veo 3.1: up to 3, 8 s with references, the @Image tags in words.
    await gen.generate({ prompt: 'Theo (@Image1) by @Image2', references: refs, duration: 4, resolution: '1080p', aspect: '9:16', model: 'veo-3.1-fast' });
    // Veo from a first and a last frame; Kling from a first frame.
    await gen.generate({ prompt: 'carry on', firstFrame: 'https://cdn.test/a.jpg', lastFrame: 'https://cdn.test/b.jpg', duration: 5, model: 'veo-3.1' });
    await gen.generate({ prompt: 'carry on', firstFrame: 'https://cdn.test/a.jpg', duration: 3, model: 'kling-o3-standard' });
    // Wan and MiniMax take no reference pictures: the first frame, or the prompt only.
    await gen.generate({ prompt: 'carry on', references: refs, firstFrame: 'https://cdn.test/a.jpg', duration: 12, resolution: '480p', model: 'wan-2.6' });
    await gen.generate({ prompt: 'words', references: refs, duration: 7.4, resolution: '768p', aspect: '21:9', model: 'minimax-h3-max' });
    const [kl, ve, fl, ki, wa, mm] = fal.posts();
    expect(kl.url).toBe('https://queue.fal.run/fal-ai/kling-video/o3/pro/reference-to-video');
    expect(kl.body).toEqual({ prompt: 'Theo (@Image1)', duration: '15', generate_audio: true, aspect_ratio: '1:1', image_urls: refs.slice(0, 4) });
    expect(ve.url).toBe('https://queue.fal.run/fal-ai/veo3.1/fast/reference-to-video');
    expect(ve.body).toEqual({ prompt: 'Theo (reference image 1) by reference image 2', aspect_ratio: '9:16', duration: '8s', resolution: '1080p', generate_audio: false, image_urls: refs.slice(0, 3) });
    expect(fl.url).toBe('https://queue.fal.run/fal-ai/veo3.1/first-last-frame-to-video');
    expect(fl.body).toMatchObject({ first_frame_url: 'https://cdn.test/a.jpg', last_frame_url: 'https://cdn.test/b.jpg', duration: '6s' });
    expect(ki.url).toBe('https://queue.fal.run/fal-ai/kling-video/o3/standard/image-to-video');
    expect(ki.body).toEqual({ prompt: 'carry on', duration: '3', generate_audio: false, image_url: 'https://cdn.test/a.jpg' });
    expect(wa.url).toBe('https://queue.fal.run/wan/v2.6/image-to-video');
    expect(wa.body).toEqual({ prompt: 'carry on', resolution: '720p', duration: '10', image_url: 'https://cdn.test/a.jpg' });
    expect(mm.url).toBe('https://queue.fal.run/minimax/h3-max/text-to-video');
    expect(mm.body).toEqual({ prompt: 'words', duration: 7, resolution: '768P', prompt_expansion_mode: 'disabled', aspect_ratio: '21:9' });
    await expect(gen.generate({ prompt: 'x'.repeat(1600), model: 'wan-2.6' })).rejects.toThrow(/up to 1,500 characters; this one has 1600/);
  });

  it('prices sound where it costs more, and Veo’s 8-second reference clips', () => {
    const gen = falVideoGenerator({ apiKey: 'k' });
    expect(gen.estimate!({ model: 'kling-o3-pro', duration: 5 })!.amount).toBe(0.56); // 5 × $0.112
    expect(gen.estimate!({ model: 'kling-o3-pro', duration: 5, audio: true })!.amount).toBe(0.7); // 5 × $0.14
    expect(gen.estimate!({ model: 'veo-3.1', duration: 4, resolution: '1080p', audio: true })!.amount).toBe(1.6);
    expect(gen.estimate!({ model: 'veo-3.1-fast', duration: 4, resolution: '720p', references: 2 })).toMatchObject({ amount: 0.8, seconds: 8 }); // 8 s
    expect(gen.estimate!({ model: 'wan-2.6', duration: 7, resolution: '1080p', audio: true })!.amount).toBe(0.75); // 5 s; no sound option
    expect(gen.estimate!({ model: 'minimax-h3-max', duration: 5, resolution: '768p' })!.amount).toBe(0.4);
    expect(gen.estimate!({ model: 'seedance-2.0-mini', duration: 5, resolution: '480p', audio: true })!.amount).toBe(0.36); // the same with sound
  });

  it('estimates from fal’s listed prices: model, resolution and length decide it', () => {
    const gen = falVideoGenerator({ apiKey: 'k' });
    expect(gen.estimate!({ model: 'seedance-2.0-mini', duration: 5, resolution: '480p' })).toEqual({ amount: 0.36, unit: 'USD', basis: "fal's listed price" });
    expect(gen.estimate!({ model: 'seedance-2.0', duration: 7, resolution: '720p' })!.amount).toBe(2.12); // 7 × $0.3024
    expect(gen.estimate!({ model: 'seedance-2.0-fast', duration: 10, resolution: '1080p' })!.amount).toBe(2.42); // Fast stops at 720p
    expect(gen.estimate!({ model: 'seedance-2.5', duration: 40, resolution: '1080p' })!.amount).toBe(34.92); // 30 s at most
    expect(gen.estimate!({ model: 'nope' })).toBeUndefined();
  });

  it('keeps waiting through lost connections, hands over the job, and can resume it later', async () => {
    let failures = 2;
    let polls = 0;
    const calls: string[] = [];
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
    const fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push(url);
      if (init.method === 'POST')
        return json({ request_id: 'req-9', status_url: 'https://evil.test/steal', response_url: 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-9' });
      if (url.endsWith('/status')) {
        if (failures-- > 0) throw new TypeError('Failed to fetch'); // the phone slept
        return json(++polls < 2 ? { status: 'IN_PROGRESS' } : { status: 'COMPLETED' });
      }
      return json({ video: { url: 'https://v3.fal.media/files/clip.mp4' } });
    }) as unknown as typeof globalThis.fetch;
    const gen = falVideoGenerator({ apiKey: 'k', fetch, pollMs: 1 });
    const jobs: any[] = [];
    const progress: string[] = [];
    const res = await gen.generate({ prompt: 'x', onSubmitted: (j) => jobs.push(j), onProgress: (t) => progress.push(t) });
    expect(res.videos).toEqual(['https://v3.fal.media/files/clip.mp4']);
    expect(progress).toContain('Lost touch with fal; trying again…');
    // The job: no key in it, and only fal's own URLs (the off-fal status URL was ignored).
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ service: 'fal', request: 'req-9', status: 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-9/status', result: 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-9' });
    expect(JSON.stringify(jobs[0])).not.toContain('k-');
    expect(calls.some((u) => u.includes('evil.test'))).toBe(false);
    // Later, from the saved job: no second submit.
    polls = 0;
    const again = await gen.resume!(jobs[0]);
    expect(again.videos).toEqual(['https://v3.fal.media/files/clip.mp4']);
    expect(calls.filter((u) => u.endsWith('/text-to-video'))).toHaveLength(1);
    // Jobs that aren't fal's are refused.
    await expect(gen.resume!({ ...jobs[0], status: 'https://evil.test/x' })).rejects.toThrow('not on fal');
    await expect(gen.resume!({ service: 'other', startedAt: 0 })).rejects.toThrow('not on fal');
  });

  it('says a job is still pending (rather than failed) when it runs out of time', async () => {
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
    const g2 = falVideoGenerator({
      apiKey: 'k',
      pollMs: 1,
      timeoutMs: 5,
      fetch: (async (_u: string, init: RequestInit = {}) => json(init.method === 'POST' ? { request_id: 'r' } : { status: 'IN_QUEUE' })) as unknown as typeof fetch,
    });
    await expect(g2.generate({ prompt: 'x' })).rejects.toMatchObject({ code: 'pending' });
  });

  it('refuses SVG drawings (fal can’t read them) before uploading anything', async () => {
    const fal = fakeFal({ video: { url: 'https://v/c.mp4' } });
    const gen = falVideoGenerator({ apiKey: 'k', fetch: fal.fetch, pollMs: 1 });
    await expect(gen.generate({ prompt: 'x', references: ['data:image/svg+xml,%3Csvg%2F%3E'] })).rejects.toThrow('fal can’t read SVG drawings');
    expect(fal.calls.some((c) => c.url.includes('/storage/upload'))).toBe(false);
    expect(fal.posts()).toHaveLength(0);
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
    const { g, editor } = mount();
    await editor.setView('shots');
    await openSheet(editor, 's1b');
    const field = () => inSheet('lastFrame');
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

  it('lets people pick which of a card’s pictures to send, and remembers it on the shot', async () => {
    let asked: VideoRequest | undefined;
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [{ id: 'm', label: 'M', minDuration: 4, maxDuration: 15, aspects: ['16:9'], resolutions: ['720p'] }], defaultModel: 'm', async generate(req) {
      asked = req;
      return { videos: [] };
    } }]);
    const { g, editor } = mount();
    const A = 'data:image/png;base64,QQ==', B = 'data:image/png;base64,Qg==';
    g.setParam('hall', 'images', [A, B]);
    // Unpicked: the first leads, the second goes along as another view.
    expect(seedanceShot(toDrama(g), 's1b').refs.filter((r) => r.card === 'hall').map((r) => r.src)).toEqual([A, B]);
    await editor.setView('shots');
    await openSheet(editor, 's1b');
    const field = () => inSheet('lastFrame');
    [...field().querySelectorAll('button')].find((b) => b.textContent === '🎬 Generate clip')!.click();
    const panel = field().querySelector<HTMLElement>('.dr-clip-panel')!;
    const sw = [...panel.querySelectorAll<HTMLButtonElement>('.dr-gen-pick')];
    expect(sw.map((b) => b.textContent)).toEqual(['⇄ 1/2']); // on the hall’s main picture, not its extra view
    sw[0].click();
    await tick(10);
    const sheet = document.querySelector<HTMLElement>('.nm-choose')!;
    expect([...sheet.querySelectorAll('.nm-sheet-item')].map((b) => b.textContent)).toEqual([expect.stringContaining('Picture 1'), expect.stringContaining('Picture 2')]);
    await tick(360);
    sheet.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')[1].click();
    await tick(10);
    expect(g.nodes.get('s1b')!.params.referencePicks).toEqual({ hall: B });
    expect(field().querySelector('.dr-clip-panel')).toBe(panel); // still open
    expect(sw[0].textContent).toBe('⇄ 2/2');
    // The hall's extra view goes off (picked: only that picture is sent), showing the other picture.
    const view = panel.querySelector<HTMLElement>('.dr-gen-ref[aria-label="School hall (location, view 2)"]')!;
    expect(view.getAttribute('aria-pressed')).toBe('false');
    expect(view.querySelector('img')!.getAttribute('src')).toBe(A);
    panel.querySelector<HTMLButtonElement>('.dr-gen-go')!.click();
    await tick(30);
    expect(asked!.references).toContain(B);
    expect(asked!.references).not.toContain(A);
    // Picked: only that picture goes, from now on.
    const refs = seedanceShot(toDrama(g), 's1b').refs.filter((r) => r.card === 'hall');
    expect(refs.map((r) => r.src)).toEqual([B]);
    const pic = dramaImageReferences(toDrama(g), toDrama(g).nodes.get('s1b')!).find((r) => r.card === 'hall')!;
    expect(pic).toMatchObject({ src: B, choices: [A, B] });
    // A picture that's gone falls back to the first.
    g.setParam('hall', 'images', [A]);
    expect(dramaImageReferences(toDrama(g), toDrama(g).nodes.get('s1b')!).find((r) => r.card === 'hall')).toEqual({ src: A, label: expect.any(String), card: 'hall' });
    editor.destroy();
  });

  it('opens ✨ Picture and 🎬 Clip from the cards, in a sheet with the panel open', async () => {
    // No services set up: no buttons.
    const none = mount();
    await none.editor.setView('shots');
    expect(none.el.querySelector('.nm-node[data-id="s1b"] .nm-card-action')).toBeNull();
    none.editor.destroy();
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [{ id: 'm', label: 'M' }], async generate() {
      return { videos: [] };
    } }]);
    setImageGenerators([{ id: 'img', name: 'Img', async generate() {
      return { images: [] };
    } }]);
    const { el, editor } = mount();
    await editor.setView('shots');
    const clip = el.querySelector<HTMLButtonElement>('.nm-node[data-id="s1b"] .nm-card-action')!;
    expect(clip.textContent).toBe('🎬 Clip');
    clip.click();
    let sheet = [...document.querySelectorAll<HTMLElement>('.nm-field-sheet')].pop()!;
    expect(sheet.getAttribute('aria-label')).toBe('🎬 Clip · Shot 2 · Close-up');
    expect(sheet.querySelector('.dr-clip-panel')).not.toBeNull();
    editor.closePalette();
    await editor.setView('cast');
    el.querySelector<HTMLButtonElement>('.nm-node[data-id="theo"] .nm-card-action')!.click();
    sheet = [...document.querySelectorAll<HTMLElement>('.nm-field-sheet')].pop()!;
    expect(sheet.getAttribute('aria-label')).toBe('✨ Picture · Theo');
    expect(sheet.querySelector('.dr-gen-panel')).not.toBeNull();
    editor.closePalette();
    editor.destroy();
  });

  it('folds the panels away again from the button that opened them', async () => {
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [{ id: 'm', label: 'M' }], async generate() {
      return { videos: [] };
    } }]);
    setImageGenerators([{ id: 'img', name: 'Img', async generate() {
      return { images: [] };
    } }]);
    const { editor } = mount();
    await editor.setView('shots');
    await openSheet(editor, 's1b');
    const clipBtn = () => [...inSheet('lastFrame').querySelectorAll<HTMLButtonElement>('.dr-clip-btn')].find((b) => b.hasAttribute('aria-expanded'))!;
    expect(clipBtn().textContent).toBe('🎬 Generate clip');
    clipBtn().click();
    expect(inSheet('lastFrame').querySelector('.dr-clip-panel')).not.toBeNull();
    expect(clipBtn().textContent).toBe('✕ Close');
    expect(clipBtn().getAttribute('aria-expanded')).toBe('true');
    clipBtn().click();
    expect(inSheet('lastFrame').querySelector('.dr-clip-panel')).toBeNull();
    const spark = () => inSheet('images').querySelector<HTMLButtonElement>('.dr-gen:not(.dr-browse)')!;
    spark().click();
    expect(inSheet('images').querySelector('.dr-gen-panel')).not.toBeNull();
    expect(spark().textContent).toBe('✕');
    spark().click();
    expect(inSheet('images').querySelector('.dr-gen-panel')).toBeNull();
    expect(spark().textContent).toBe('✨');
    editor.closePalette();
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

describe('🎬 clips that finish while the page is away', () => {
  const mount = () => {
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    return { g, el, editor };
  };
  const job = { service: 'fake', startedAt: Date.UTC(2026, 10, 27, 6, 30), request: 'r1' };

  it('shows a clip being made, collects it when it is ready, and forgets the job', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    let asked = 0;
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [], async generate() {
      return { videos: [] };
    }, async resume(j) {
      asked++;
      expect(j).toMatchObject(job);
      return { videos: ['https://v/done.mp4'] };
    } }]);
    const { g, el, editor } = mount();
    g.setParam('s1b', 'clipJob', job);
    await editor.setView('shots');
    await tick(20);
    expect(asked).toBe(1);
    expect(g.nodes.get('s1b')!.params.clipUrl).toBe('https://v/done.mp4');
    expect(g.nodes.get('s1b')!.params.clipJob).toBeNull();
    // The card is now the clip (no job left on it).
    const field = onCard(el, 's1b', 'lastFrame');
    expect(field.querySelector('.dr-clip-play')).not.toBeNull();
    expect(field.querySelector('.dr-clip-making')).toBeNull();
    globalThis.fetch = realFetch;
    editor.destroy();
  });

  it('keeps a job that is still running, and drops one that failed', async () => {
    let outcome: 'pending' | 'failed' = 'pending';
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [], async generate() {
      return { videos: [] };
    }, async resume() {
      throw outcome === 'pending' ? Object.assign(new Error('Still generating on Fake.'), { code: 'pending' }) : new Error('Content policy');
    } }]);
    const { g, el, editor } = mount();
    g.setParam('s1b', 'clipJob', job);
    await editor.setView('shots');
    await tick(20);
    const card = () => onCard(el, 's1b', 'lastFrame');
    expect(g.nodes.get('s1b')!.params.clipJob).toEqual(job);
    // The card says so, big: over a 16:9 box, with the service and the time so far, and what it last said.
    const over = card().querySelector<HTMLElement>('.dr-clip-making .dr-pending.dr-clip-over')!;
    expect(over.getAttribute('aria-label')).toBe('Generating on fake…');
    expect(over.querySelector('.dr-pending-time')!.textContent).toMatch(/^\d+:\d\d$/);
    expect(card().textContent).toMatch(/Still generating on Fake/);
    // The Edit sheet has the details and Check now; one clip at a time.
    await openSheet(editor, 's1b');
    expect(inSheet('lastFrame').querySelector('.dr-clip-job')!.textContent).toMatch(/^⏳ Generating on fake since/);
    expect([...inSheet('lastFrame').querySelectorAll('button')].some((b) => b.textContent === '🎬 Generate clip')).toBe(false);
    outcome = 'failed';
    [...inSheet('lastFrame').querySelectorAll('button')].find((b) => b.textContent === 'Check now')!.click();
    await tick(20);
    expect(g.nodes.get('s1b')!.params.clipJob).toBeNull();
    expect(inSheet('lastFrame').textContent).toMatch(/The clip didn't finish on Fake: Content policy/);
    expect(card()).toBeNull(); // nothing being made, no clip: the card has no clip box
    editor.closePalette();
    editor.destroy();
  });
});

describe('placeholders while generating', () => {
  const mount = () => {
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    return { g, el, editor };
  };

  it('shows a picture being made in the strip, with the percent the service reports', async () => {
    let finish!: (v: { images: string[] }) => void;
    let report!: (pc: number) => void;
    setImageGenerators([{ id: 'meshy', name: 'Meshy', async generate(req) {
      report = (pc) => req.onProgress?.(pc);
      return new Promise((r) => (finish = r));
    } }]);
    const { el, editor } = mount();
    const field = () => el.querySelector<HTMLElement>('.nm-node[data-id="theo"] [data-param="images"]')!;
    field().querySelector<HTMLButtonElement>('.dr-gen')!.click();
    field().querySelector<HTMLButtonElement>('.dr-gen-go')!.click();
    await tick();
    const tile = () => field().querySelector<HTMLElement>('.dr-pending.dr-thumb');
    expect(tile()!.classList.contains('dr-indeterminate')).toBe(true); // no percent yet: it moves
    report(42);
    expect(tile()!.getAttribute('aria-label')).toBe('Generating with Meshy 42%');
    expect(tile()!.style.getPropertyValue('--pc')).toBe('42');
    expect(tile()!.querySelector('.dr-pending-pc')!.textContent).toBe('42%');
    finish({ images: ['data:image/png;base64,QUJD'] });
    await tick(20);
    expect(tile()).toBeNull();
    editor.destroy();
  });

  it('shows a clip being made where it will go, with what the service says and the time', async () => {
    let finish!: (v: { videos: string[] }) => void;
    setVideoGenerators([{ id: 'fal', name: 'fal', models: [{ id: 'm', label: 'M', minDuration: 4, maxDuration: 15 }], async generate(req) {
      req.onSubmitted?.({ service: 'fal', startedAt: Date.now(), request: 'r' });
      req.onProgress?.("In fal's queue (2 ahead)…");
      return new Promise((r) => (finish = r));
    } }]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const { g, editor } = mount();
    // Photos (PNG), which need no canvas to send (happy-dom has none for the example's drawings).
    for (const n of g.nodes.values()) if (Array.isArray(n.params.images) && n.params.images.length) g.setParam(n.id, 'images', [`data:image/png;base64,${btoa(n.id)}`]);
    await editor.setView('shots');
    await openSheet(editor, 's1b');
    const field = () => inSheet('lastFrame');
    [...field().querySelectorAll('button')].find((b) => b.textContent === '🎬 Generate clip')!.click();
    field().querySelector<HTMLButtonElement>('.dr-gen-go')!.click();
    await tick(20);
    const tile = () => field().querySelector<HTMLElement>('.dr-pending.dr-clip-tile');
    expect(tile()!.getAttribute('aria-label')).toBe("In fal's queue (2 ahead)…");
    expect(tile()!.classList.contains('dr-indeterminate')).toBe(true); // fal gives no percent
    expect(tile()!.querySelector('.dr-pending-time')!.textContent).toMatch(/^0:0\d$/);
    // The shot's card on the board says the same, big, as fal reports it.
    const card = () => document.querySelector<HTMLElement>('.nm-node[data-id="s1b"] .dr-clip-card');
    expect(card()!.classList.contains('dr-clip-making')).toBe(true);
    expect(card()!.querySelector('.dr-clip-over')!.getAttribute('aria-label')).toBe("In fal's queue (2 ahead)…");
    finish({ videos: ['https://v/clip.mp4'] });
    await tick(20);
    expect(tile()).toBeNull();
    expect(g.nodes.get('s1b')!.params.clipUrl).toBe('https://v/clip.mp4');
    expect(card()!.classList.contains('dr-clip-making')).toBe(false);
    globalThis.fetch = realFetch;
    editor.closePalette();
    editor.destroy();
  });
});

describe('keeping clips', () => {
  const mount = () => {
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    return { g, el, editor };
  };
  afterEach(() => setClipKeeper(null));

  it('keeps a copy of a finished clip where the host says, and plays it in the card', async () => {
    const kept: string[] = [];
    setClipKeeper(async (url, info) => {
      kept.push(`${info.shotId} ${url}`);
      return 'https://app.test/api/clips/abc.mp4';
    });
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [], async generate() {
      return { videos: [] };
    }, async resume() {
      return { videos: ['https://v3.fal.media/files/clip.mp4'] };
    } }]);
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (u: string) => {
      fetched.push(String(u));
      throw new TypeError('offline');
    }) as typeof fetch;
    const { g, el, editor } = mount();
    g.setParam('s1b', 'clipJob', { service: 'fake', startedAt: 1, request: 'r' });
    await editor.setView('shots');
    await tick(30);
    expect(kept).toEqual(['s1b https://v3.fal.media/files/clip.mp4']);
    expect(g.nodes.get('s1b')!.params.clipUrl).toBe('https://app.test/api/clips/abc.mp4');
    expect(fetched).toEqual(['https://app.test/api/clips/abc.mp4']); // the last frame comes from the copy
    // ▶ plays the copy full screen, with sound.
    el.querySelector<HTMLButtonElement>('.nm-node[data-id="s1b"] .dr-clip-play')!.click();
    const video = document.querySelector<HTMLVideoElement>('.dr-player video')!;
    expect(video.getAttribute('src')).toBe('https://app.test/api/clips/abc.mp4');
    expect(video.muted).toBe(false);
    document.querySelector<HTMLButtonElement>('.dr-player button[aria-label="Close the clip"]')!.click();
    expect(document.querySelector('.dr-player')).toBeNull();
    globalThis.fetch = realFetch;
    editor.destroy();
  });

  it('keeps a clip still on the service when its shot is shown, once', async () => {
    let asked = 0;
    setClipKeeper(async () => {
      asked++;
      throw new Error('expired');
    });
    const { g, editor } = mount();
    g.setParam('s1c', 'clipUrl', 'https://v3.fal.media/files/old.mp4');
    await editor.setView('shots');
    await tick(30);
    g.setParam('s1c', 'description', 'redraw'); // a redraw doesn't ask again
    await tick(30);
    expect(asked).toBe(1);
    expect(g.nodes.get('s1c')!.params.clipUrl).toBe('https://v3.fal.media/files/old.mp4'); // kept as it was
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
    await openSheet(editor, 's1b');
    const field = inSheet('lastFrame');
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
