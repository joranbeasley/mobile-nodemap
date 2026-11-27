/**
 * fal (fal.ai) adapters: Seedance clips for shots, and Nano Banana pictures, with the person's own
 * fal key. Calls go from the browser straight to fal, the way fal's own client does it:
 *
 *   submit   POST https://queue.fal.run/<endpoint>                 Authorization: Key <key>
 *   status   GET  https://queue.fal.run/<owner>/<alias>/requests/<id>/status
 *   result   GET  https://queue.fal.run/<owner>/<alias>/requests/<id>
 *   upload   POST https://rest.fal.ai/storage/upload/initiate → { upload_url, file_url }, then PUT
 *
 * Model inputs follow the types fal publishes in @fal-ai/client (types/endpoints.d.ts).
 */
import type { ImageGenerator } from './image-generation.js';
import type { VideoGenerator, VideoJob, VideoModel, VideoRequest } from './video-generation.js';

/** A fal queue request: where to ask for its status and its result. */
export interface FalJob extends VideoJob {
  service: 'fal';
  endpoint: string;
  request: string;
  status: string;
  result: string;
}

/** Only follow URLs on fal's own servers (fal.run, fal.ai), over https. */
const onFal = (u: unknown): u is string => {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' && /(^|\.)(fal\.run|fal\.ai)$/.test(url.hostname);
  } catch {
    return false;
  }
};
const pending = (message: string) => Object.assign(new Error(message), { code: 'pending' });

type FetchLike = typeof fetch;
type Key = NonNullable<VideoGenerator['key']>;

export interface FalOptions {
  /** fal's platform API (the balance), default https://api.fal.ai/v1. */
  apiUrl?: string;
  key?: Key;
  /** A fixed key instead (servers, tests). */
  apiKey?: string;
  fetch?: FetchLike;
  pollMs?: number;
  timeoutMs?: number;
  /** For tests: where fal lives. */
  queueUrl?: string;
  restUrl?: string;
}

/** Seedance on fal: one model, three endpoints (text, first frame, reference pictures). */
interface FalVideoModel extends VideoModel {
  /** How its inputs are named: each family on fal has its own. */
  family: 'seedance' | 'kling' | 'veo' | 'wan' | 'minimax';
  endpoints: { text: string; image: string; reference?: string; firstLast?: string };
  /** fal's listed price, USD per second of video, by resolution ('*': any), without sound… */
  perSecond: Record<string, number>;
  /** …and with sound, where that costs more. */
  perSecondAudio?: Record<string, number>;
}

const SEEDANCE_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const seedance = (id: string, label: string, hint: string, path: string, more: Partial<FalVideoModel>): FalVideoModel => ({
  id,
  label,
  hint,
  family: 'seedance',
  endpoints: { text: `${path}/text-to-video`, image: `${path}/image-to-video`, reference: `${path}/reference-to-video` },
  minDuration: 4,
  maxDuration: 15,
  aspects: SEEDANCE_ASPECTS,
  maxReferences: 9,
  firstFrame: true,
  audio: true, // the same price with or without sound
  resolutions: [],
  perSecond: {},
  ...more,
});
const kling = (tier: 'pro' | 'standard', rate: number, withSound: number): FalVideoModel => ({
  id: `kling-o3-${tier}`,
  label: `Kling O3 ${tier === 'pro' ? 'Pro' : 'Standard'}`,
  hint: `Kling; up to 4 reference pictures (@Image1…); 3–15 s${tier === 'standard' ? '; cheaper' : ''}`,
  family: 'kling',
  endpoints: { text: `fal-ai/kling-video/o3/${tier}/text-to-video`, image: `fal-ai/kling-video/o3/${tier}/image-to-video`, reference: `fal-ai/kling-video/o3/${tier}/reference-to-video` },
  minDuration: 3,
  maxDuration: 15,
  aspects: ['16:9', '9:16', '1:1'],
  // fal: "Maximum 4 total (elements + reference images)" (said for video elements; the safe limit).
  maxReferences: 4,
  firstFrame: true,
  audio: true,
  perSecond: { '*': rate },
  perSecondAudio: { '*': withSound },
});
const veo = (fast: boolean): FalVideoModel => ({
  id: fast ? 'veo-3.1-fast' : 'veo-3.1',
  label: fast ? 'Veo 3.1 Fast' : 'Veo 3.1',
  hint: `Google; 4, 6 or 8 s (8 s with reference pictures, up to 3)${fast ? '; cheaper' : ''}`,
  family: 'veo',
  endpoints: fast
    ? { text: 'fal-ai/veo3.1/fast', image: 'fal-ai/veo3.1/fast/image-to-video', reference: 'fal-ai/veo3.1/fast/reference-to-video', firstLast: 'fal-ai/veo3.1/fast/first-last-frame-to-video' }
    : { text: 'fal-ai/veo3.1', image: 'fal-ai/veo3.1/image-to-video', reference: 'fal-ai/veo3.1/reference-to-video', firstLast: 'fal-ai/veo3.1/first-last-frame-to-video' },
  minDuration: 4,
  maxDuration: 8,
  durations: [4, 6, 8],
  aspects: ['16:9', '9:16'],
  resolutions: ['720p', '1080p', '4k'],
  // Google's limit for Veo 3.1 reference pictures (fal's page doesn't give one).
  maxReferences: 3,
  firstFrame: true,
  audio: true,
  perSecond: fast ? { '720p': 0.1, '1080p': 0.1, '4k': 0.3 } : { '720p': 0.2, '1080p': 0.2, '4k': 0.4 },
  perSecondAudio: fast ? { '720p': 0.15, '1080p': 0.15, '4k': 0.35 } : { '720p': 0.4, '1080p': 0.4, '4k': 0.6 },
});

export const FAL_VIDEO_MODELS: FalVideoModel[] = [
  seedance('seedance-2.0', 'Seedance 2.0', 'Best quality; up to 4K', 'bytedance/seedance-2.0/us', {
    resolutions: ['480p', '720p', '1080p', '4k'],
    perSecond: { '480p': 0.1406, '720p': 0.3024, '1080p': 0.7484, '4k': 1.5552 },
  }),
  seedance('seedance-2.0-fast', 'Seedance 2.0 Fast', 'Quicker and cheaper; up to 720p', 'bytedance/seedance-2.0/fast', {
    resolutions: ['480p', '720p'],
    // fal lists 720p only; 480p from its token price ($0.0112 per 1,000 tokens) at Mini's 480p token count.
    perSecond: { '480p': 0.1154, '720p': 0.2419 },
  }),
  seedance('seedance-2.0-mini', 'Seedance 2.0 Mini', 'Cheapest; drafts; up to 720p', 'bytedance/seedance-2.0/mini', {
    resolutions: ['480p', '720p'],
    perSecond: { '480p': 0.0721, '720p': 0.1547 },
  }),
  seedance('seedance-2.5', 'Seedance 2.5', 'Newest; clips up to 30 s; up to 1080p', 'bytedance/seedance-2.5/us', {
    maxDuration: 30,
    resolutions: ['480p', '720p', '1080p'],
    perSecond: { '480p': 0.2205, '720p': 0.473, '1080p': 1.164 },
  }),
  kling('pro', 0.112, 0.14),
  kling('standard', 0.084, 0.112),
  veo(false),
  veo(true),
  {
    id: 'wan-2.6',
    label: 'Wan 2.6',
    hint: 'No reference pictures (prompt, or a continuing shot’s first frame); 5, 10 or 15 s; prompts up to 1,500 characters',
    family: 'wan',
    endpoints: { text: 'wan/v2.6/text-to-video', image: 'wan/v2.6/image-to-video' },
    minDuration: 5,
    maxDuration: 15,
    durations: [5, 10, 15],
    aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'],
    maxReferences: 0,
    firstFrame: true,
    audio: false,
    perSecond: { '720p': 0.1, '1080p': 0.15 },
  },
  {
    id: 'minimax-h3-max',
    label: 'MiniMax H3 Max',
    hint: 'Cheap; no reference pictures (prompt, or a continuing shot’s first frame); up to 15 s',
    family: 'minimax',
    endpoints: { text: 'minimax/h3-max/text-to-video', image: 'minimax/h3-max/image-to-video' },
    minDuration: 1,
    maxDuration: 15,
    aspects: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['480p', '768p', '1080p'],
    maxReferences: 0,
    firstFrame: true,
    audio: false,
    // Standard rates from 16 Nov 2026 (fal ran discounts before that).
    perSecond: { '480p': 0.05, '768p': 0.08, '1080p': 0.16 },
  },
];
/**
 * Models that change a clip on fal (✏️ Change this clip): Kling O3's video edit (your words and up
 * to 4 pictures; keeps the sound) and Decart's Lucy Edit Pro (words only). fal's listed prices.
 */
export const FAL_VIDEO_EDIT_MODELS = [
  { id: 'kling-o3-pro-edit', label: 'Kling O3 Pro edit', endpoint: 'fal-ai/kling-video/o3/pro/video-to-video/edit', perSecond: 0.168, maxReferences: 4, audio: true, minSeconds: 3, maxSeconds: 15, minHeight: 720, hint: 'Changes what you say and keeps the rest; up to 4 pictures; clips of 3–15 s at 720p or more' },
  { id: 'kling-o3-standard-edit', label: 'Kling O3 Standard edit', endpoint: 'fal-ai/kling-video/o3/standard/video-to-video/edit', perSecond: 0.126, maxReferences: 4, audio: true, minSeconds: 3, maxSeconds: 15, minHeight: 720, hint: 'Cheaper; clips of 3–15 s at 720p or more' },
  { id: 'lucy-edit-pro', label: 'Lucy Edit Pro', endpoint: 'decart/lucy-edit/pro', perSecond: 0.15, maxReferences: 0, audio: false, hint: 'Words only (clothes, setting, objects); any clip; 720p out' },
];

/** Where the prices come from (each model's https://fal.ai/models/<endpoint>/llms.txt, Nov 2026). They change: fal bills what it bills. */
export const FAL_PRICE_BASIS = "fal's listed price";

/** Nano Banana (Google's Gemini image models) on fal: `edit` takes reference pictures. */
export const FAL_IMAGE_MODELS = [
  // fal's listed price per picture (at the default 1K size), the same with or without references.
  { id: 'fal-ai/nano-banana-2', label: 'Nano Banana 2', edit: 'fal-ai/nano-banana-2/edit', perImage: 0.08 },
  { id: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro', edit: 'fal-ai/nano-banana-pro/edit', perImage: 0.15 },
  { id: 'fal-ai/nano-banana', label: 'Nano Banana', edit: 'fal-ai/nano-banana/edit', perImage: 0.0398 },
];
const IMAGE_ASPECTS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];

/** The queue, uploads and errors, shared by both adapters. */
function falClient(opts: FalOptions) {
  const queue = (opts.queueUrl ?? 'https://queue.fal.run').replace(/\/$/, '');
  const rest = (opts.restUrl ?? 'https://rest.fal.ai').replace(/\/$/, '');
  const api = (opts.apiUrl ?? 'https://api.fal.ai/v1').replace(/\/$/, '');
  const doFetch: FetchLike = opts.fetch ?? ((...a: Parameters<FetchLike>) => fetch(...a));
  let memoryKey = '';
  const key: Key = opts.key ?? { label: 'fal API key', get: () => opts.apiKey ?? memoryKey, set: (v: string) => void (memoryKey = v) };
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Cancelled', 'AbortError'));
      });
    });
  const auth = () => {
    const k = key.get();
    if (!k) throw new Error('Add your fal API key first');
    return `Key ${k}`;
  };
  /** fal's error bodies: { detail: string | [{ msg, loc }] } or { message }. */
  const reason = (body: Record<string, any>, status: number) => {
    const d = body?.detail;
    const text = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => `${x?.loc ? `${[].concat(x.loc).slice(-1)[0]}: ` : ''}${x?.msg ?? JSON.stringify(x)}`).join('; ') : body?.message;
    return text || `fal said ${status}${status === 401 || status === 403 ? ': check your API key' : status === 402 ? ': no credit left on your fal account' : ''}`;
  };
  const call = async (url: string, init: RequestInit = {}) => {
    const authorization = auth(); // no key: say so, rather than a network error
    let res: Response;
    try {
      res = await doFetch(url, { ...init, headers: { Authorization: authorization, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw Object.assign(new Error("This page can't reach fal: where it is open, calls to other sites are blocked."), { code: 'blocked' });
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(reason(body, res.status));
    return body;
  };

  /** A picture fal can fetch: https links go as they are; anything else (data: URIs, this site's own links) is uploaded. */
  const uploaded = new Map<string, Promise<string>>();
  const fileUrl = (src: string, signal?: AbortSignal): Promise<string> => {
    if (/^https:\/\//i.test(src) && !src.startsWith(globalThis.location?.origin ?? '\u0000')) return Promise.resolve(src);
    if (!uploaded.has(src))
      uploaded.set(
        src,
        (async () => {
          // fal reads JPEG, PNG, WebP and GIF; drawings must be turned into one first (referencePicture).
          const svg = () => new Error('fal can’t read SVG drawings: convert them to JPEG or PNG first');
          if (/^data:image\/svg/i.test(src)) throw svg();
          const blob = await (await doFetch(src, { signal, credentials: 'same-origin' })).blob();
          if (/svg/i.test(blob.type)) throw svg();
          const type = blob.type || 'image/jpeg';
          const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
          const { upload_url, file_url } = await call(`${rest}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
            method: 'POST',
            signal,
            body: JSON.stringify({ content_type: type, file_name: `drama-${Date.now()}.${ext}` }),
          });
          const put = await doFetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': type }, signal });
          if (!put.ok) throw new Error(`Uploading a picture to fal failed (${put.status})`);
          return file_url as string;
        })().catch((err) => (uploaded.delete(src), Promise.reject(err))),
      );
    return uploaded.get(src)!;
  };

  /** Send a job to fal's queue. A second submit would be a second (billed) job, so this happens once. */
  const submit = async (endpoint: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<FalJob> => {
    const submitted = await call(`${queue}/${endpoint}`, { method: 'POST', signal, body: JSON.stringify(input) });
    const id = submitted.request_id;
    if (!id) throw new Error('fal did not return a request');
    // Status and result live under the app (owner/alias), not the full endpoint path. Use the URLs
    // fal returns when they are on fal's own servers.
    const app = endpoint.split('/').slice(0, 2).join('/');
    return {
      service: 'fal',
      startedAt: Date.now(),
      endpoint,
      request: String(id),
      status: onFal(submitted.status_url) ? submitted.status_url : `${queue}/${app}/requests/${id}/status`,
      result: onFal(submitted.response_url) ? submitted.response_url : `${queue}/${app}/requests/${id}`,
    };
  };

  /**
   * Wait for a job and return its result. Losing touch with fal (a phone asleep, a tab in the
   * background, a dropped connection) doesn't end the wait: it tries again, backing off. Running
   * out of time rejects with code 'pending': the job may still finish, so keep it.
   */
  const wait = async (job: FalJob, signal?: AbortSignal, onStatus?: (s: string) => void, timeoutMs = opts.timeoutMs ?? 15 * 60_000) => {
    if (!onFal(job.status) || !onFal(job.result)) throw new Error('That job is not on fal');
    const until = Date.now() + timeoutMs;
    let retry = opts.pollMs ?? 3000;
    const tryCall = async (url: string) => {
      for (;;) {
        try {
          const r = await call(url, { signal });
          retry = opts.pollMs ?? 3000;
          return r;
        } catch (err) {
          if ((err as { code?: string }).code !== 'blocked') throw err;
          if (Date.now() > until) throw pending('Lost touch with fal. The clip may still finish: it will be collected when fal can be reached.');
          onStatus?.('Lost touch with fal; trying again…');
          await sleep(retry, signal);
          retry = Math.min(retry * 2, 30_000);
        }
      }
    };
    for (;;) {
      const st = await tryCall(job.status);
      if (st.status === 'COMPLETED') break;
      onStatus?.(st.status === 'IN_QUEUE' ? `In fal's queue${typeof st.queue_position === 'number' ? ` (${st.queue_position} ahead)` : ''}…` : 'Generating…');
      if (Date.now() > until) throw pending('Still generating on fal. It will be collected when it is ready.');
      await sleep(opts.pollMs ?? 3000, signal);
    }
    return tryCall(job.result);
  };

  /** Submit, wait in the queue, and return the result. */
  const run = async (endpoint: string, input: Record<string, unknown>, signal?: AbortSignal, onStatus?: (s: string) => void) =>
    wait(await submit(endpoint, input, signal), signal, onStatus);
  /**
   * The account's credit balance in USD (fal's billing API). Only keys with billing access can
   * read it (fal's BILLING, READONLY or FULL presets); otherwise undefined.
   */
  const balance = async (signal?: AbortSignal): Promise<number | undefined> => {
    const k = key.get();
    if (!k) return undefined;
    try {
      const res = await doFetch(`${api}/account/billing?expand=credits`, { headers: { Authorization: `Key ${k}` }, signal });
      if (!res.ok) return undefined;
      const b = (await res.json()) as { credits?: { current_balance?: number } };
      return typeof b.credits?.current_balance === 'number' ? b.credits.current_balance : undefined;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      return undefined;
    }
  };
  return { key, run, submit, wait, fileUrl, balance };
}

const nearest = (values: string[] | undefined, want: string | undefined, fallback: string) => {
  if (!values?.length) return want ?? fallback;
  if (want && values.includes(want)) return want;
  const ratio = (a: string) => {
    const [w, h] = a.split(':').map(Number);
    return w && h ? w / h : NaN;
  };
  const r = want ? ratio(want) : NaN;
  if (!Number.isNaN(r)) return [...values].sort((a, b) => Math.abs(ratio(a) - r) - Math.abs(ratio(b) - r))[0];
  return values.includes(fallback) ? fallback : values[0];
};

const clipOf = (out: Record<string, any>) => {
  const url = out?.video?.url;
  if (!url) throw new Error('fal returned no clip');
  return { videos: [url as string] };
};

/** The length a model will make: snapped to the lengths it takes. */
function lengthFor(m: FalVideoModel, want: number | undefined): number {
  const d = Math.min(m.maxDuration ?? 15, Math.max(m.minDuration ?? 4, want ?? 5));
  return m.durations ? m.durations.reduce((a, b) => (Math.abs(b - d) <= Math.abs(a - d) ? b : a)) : Math.round(d);
}
/** Veo's reference-to-video makes 8-second clips only. */
const lengthWith = (m: FalVideoModel, want: number | undefined, references: number) =>
  m.family === 'veo' && references > 0 && (m.maxReferences ?? 0) > 0 ? 8 : lengthFor(m, want);

/**
 * Clips through fal: Seedance, Kling O3, Veo 3.1, Wan 2.6 and MiniMax H3. With reference pictures
 * (for models that take them) it uses the model's reference-to-video (the prompt calls them
 * @Image1, @Image2…, as the drama Seedance export writes it); with only a first frame,
 * image-to-video (a continuing shot); otherwise text-to-video.
 */
export function falVideoGenerator(opts: FalOptions & { model?: string } = {}): VideoGenerator {
  const fal = falClient(opts);
  const pick = (id?: string) => FAL_VIDEO_MODELS.find((x) => x.id === (id ?? opts.model)) ?? FAL_VIDEO_MODELS.find((x) => x.id === 'seedance-2.0-fast')!;
  return {
    id: 'fal',
    name: 'fal',
    site: 'https://fal.ai/models',
    models: FAL_VIDEO_MODELS.map(({ endpoints, perSecond, perSecondAudio, family, ...m }) => (void endpoints, void perSecond, void perSecondAudio, void family, m)),
    defaultModel: opts.model ?? 'seedance-2.0-fast',
    // The price depends on the model, resolution, length and (for some) sound; not the prompt.
    estimate({ model, duration, resolution, audio, references }) {
      const m = FAL_VIDEO_MODELS.find((x) => x.id === (model ?? opts.model ?? 'seedance-2.0-fast'));
      if (!m) return undefined;
      const table = audio && m.audio && m.perSecondAudio ? m.perSecondAudio : m.perSecond;
      const rate = table[nearest(m.resolutions, resolution, '720p')] ?? table['*'];
      if (rate == null) return undefined;
      const seconds = lengthWith(m, duration, Math.min(references ?? 0, m.maxReferences ?? 0));
      return { amount: Math.round(rate * seconds * 100) / 100, unit: 'USD', basis: FAL_PRICE_BASIS, ...(seconds !== duration ? { seconds } : {}) };
    },
    balance: ({ signal } = {}) => fal.balance(signal),
    editModels: FAL_VIDEO_EDIT_MODELS.map(({ endpoint, perSecond, ...m }) => (void endpoint, void perSecond, m)),
    editEstimate({ model, seconds }) {
      const m = FAL_VIDEO_EDIT_MODELS.find((x) => x.id === model) ?? FAL_VIDEO_EDIT_MODELS[0];
      return { amount: Math.round(m.perSecond * Math.max(1, seconds) * 100) / 100, unit: 'USD', basis: FAL_PRICE_BASIS };
    },
    async edit(req) {
      const m = FAL_VIDEO_EDIT_MODELS.find((x) => x.id === req.model) ?? FAL_VIDEO_EDIT_MODELS[0];
      req.onProgress?.('Sending the clip to fal…');
      const video = await fal.fileUrl(req.video, req.signal);
      const refs = await Promise.all((req.references ?? []).slice(0, m.maxReferences).map((r) => fal.fileUrl(r, req.signal)));
      const input =
        m.id === 'lucy-edit-pro'
          ? { prompt: req.prompt, video_url: video, resolution: '720p', enhance_prompt: false }
          : { prompt: req.prompt, video_url: video, ...(refs.length ? { image_urls: refs } : {}), keep_audio: req.keepAudio ?? true };
      const job = await fal.submit(m.endpoint, input, req.signal);
      req.onSubmitted?.(job);
      return clipOf(await fal.wait(job, req.signal, req.onProgress));
    },
    key: { help: 'From fal.ai → Dashboard → Keys. Kept in this browser only and sent only to fal. Billed by fal.', ...fal.key },
    async generate(req: VideoRequest) {
      const m = pick(req.model);
      const refs = (req.references ?? []).filter(Boolean).slice(0, m.maxReferences ?? 0);
      const seconds = lengthWith(m, req.duration, refs.length);
      const aspect = nearest(m.aspects, req.aspect, '16:9');
      const resolution = nearest(m.resolutions, req.resolution, '720p');
      const sound = m.audio ? { generate_audio: req.audio ?? false } : {};
      let prompt = req.prompt;
      if (m.family === 'wan' && prompt.length > 1500) throw new Error(`Wan takes prompts of up to 1,500 characters; this one has ${prompt.length}. Shorten it, or pick another model.`);
      // Veo doesn't name its reference pictures: say which is which in words.
      if (m.family === 'veo') prompt = prompt.replace(/@Image(\d+)/g, 'reference image $1');
      const first = !refs.length && req.firstFrame ? req.firstFrame : undefined;
      req.onProgress?.(refs.length || first ? 'Sending pictures to fal…' : 'Sending to fal…');
      const url = (src: string) => fal.fileUrl(src, req.signal);
      const urls = await Promise.all(refs.map(url));
      const firstUrl = first ? await url(first) : undefined;
      const lastUrl = first && req.lastFrame ? await url(req.lastFrame) : undefined;
      let endpoint = m.endpoints.text;
      let input: Record<string, unknown>;
      switch (m.family) {
        case 'seedance': {
          const base = { prompt, duration: String(seconds), aspect_ratio: aspect, resolution, ...sound };
          if (urls.length) (endpoint = m.endpoints.reference!), (input = { ...base, image_urls: urls });
          else if (firstUrl) (endpoint = m.endpoints.image), (input = { ...base, image_url: firstUrl, ...(lastUrl ? { end_image_url: lastUrl } : {}) });
          else input = base;
          break;
        }
        case 'kling': {
          const base = { prompt, duration: String(seconds), ...sound };
          if (urls.length) (endpoint = m.endpoints.reference!), (input = { ...base, aspect_ratio: aspect, image_urls: urls });
          else if (firstUrl) (endpoint = m.endpoints.image), (input = { ...base, image_url: firstUrl, ...(lastUrl ? { end_image_url: lastUrl } : {}) });
          else input = { ...base, aspect_ratio: aspect };
          break;
        }
        case 'veo': {
          const base = { prompt, aspect_ratio: aspect, duration: `${seconds}s`, resolution, ...sound };
          if (urls.length) (endpoint = m.endpoints.reference!), (input = { ...base, image_urls: urls });
          else if (firstUrl && lastUrl) (endpoint = m.endpoints.firstLast!), (input = { ...base, first_frame_url: firstUrl, last_frame_url: lastUrl });
          else if (firstUrl) (endpoint = m.endpoints.image), (input = { ...base, image_url: firstUrl });
          else input = base;
          break;
        }
        case 'wan': {
          const base = { prompt, resolution, duration: String(seconds) };
          if (firstUrl) (endpoint = m.endpoints.image), (input = { ...base, image_url: firstUrl });
          else input = { ...base, aspect_ratio: aspect };
          break;
        }
        case 'minimax': {
          // Our prompts are already written out in full: no rewriting.
          const base = { prompt, duration: seconds, resolution: resolution.toUpperCase(), prompt_expansion_mode: 'disabled' };
          if (firstUrl) (endpoint = m.endpoints.image), (input = { ...base, image_url: firstUrl, ...(lastUrl ? { end_image_url: lastUrl } : {}) });
          else input = { ...base, aspect_ratio: aspect };
          break;
        }
      }
      const job = await fal.submit(endpoint, input!, req.signal);
      req.onSubmitted?.(job);
      return clipOf(await fal.wait(job, req.signal, req.onProgress));
    },
    async resume(job, { signal, onProgress } = {}) {
      if (job.service !== 'fal') throw new Error('That job is not on fal');
      // A short look: the caller tries again later if it isn't ready.
      return clipOf(await fal.wait(job as FalJob, signal, onProgress, 2 * 60_000));
    },
  };
}

/** Nano Banana pictures through fal; with reference pictures it uses the edit endpoint. */
export function falImageGenerator(opts: FalOptions & { model?: string } = {}): ImageGenerator {
  const fal = falClient(opts);
  return {
    id: 'fal',
    name: 'fal',
    site: 'https://fal.ai/models',
    models: FAL_IMAGE_MODELS.map(({ id, label }) => ({ id, label })),
    defaultModel: opts.model ?? 'fal-ai/nano-banana-2',
    maxReferences: 9,
    key: { help: 'From fal.ai → Dashboard → Keys. Kept in this browser only and sent only to fal. Billed by fal.', ...fal.key },
    balance: ({ signal } = {}) => fal.balance(signal),
    async estimate({ model } = {}) {
      const m = FAL_IMAGE_MODELS.find((x) => x.id === (model ?? opts.model)) ?? FAL_IMAGE_MODELS[0];
      return { credits: m.perImage, unit: 'USD', basis: FAL_PRICE_BASIS };
    },
    async generate({ prompt, aspect, model, references, signal, onProgress }) {
      const m = FAL_IMAGE_MODELS.find((x) => x.id === (model ?? opts.model)) ?? FAL_IMAGE_MODELS[0];
      const refs = (references ?? []).filter(Boolean).slice(0, 9);
      const input: Record<string, unknown> = { prompt, num_images: 1, aspect_ratio: nearest(IMAGE_ASPECTS, aspect, '1:1') };
      if (refs.length) input.image_urls = await Promise.all(refs.map((r) => fal.fileUrl(r, signal)));
      // fal reports queued / in progress, not a percent: the placeholder shows the time instead.
      void onProgress;
      const out = await fal.run(refs.length ? m.edit : m.id, input, signal);
      const images = ((out?.images ?? []) as { url?: string }[]).map((i) => i.url).filter((u): u is string => !!u);
      if (!images.length) throw new Error('fal returned no picture');
      return { images };
    },
  };
}
