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
import type { VideoGenerator, VideoModel, VideoRequest } from './video-generation.js';

type FetchLike = typeof fetch;
type Key = NonNullable<VideoGenerator['key']>;

export interface FalOptions {
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
  endpoints: { text: string; image: string; reference: string };
  /** fal's listed price, USD per second of video, by resolution (the same for all three endpoints). */
  perSecond: Record<string, number>;
}

const SEEDANCE_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const FAL_VIDEO_MODELS: FalVideoModel[] = (<Omit<FalVideoModel, 'aspects' | 'maxReferences' | 'firstFrame' | 'audio'>[]>[
  {
    id: 'seedance-2.0',
    label: 'Seedance 2.0',
    hint: 'Best quality; up to 4K',
    endpoints: { text: 'bytedance/seedance-2.0/us/text-to-video', image: 'bytedance/seedance-2.0/us/image-to-video', reference: 'bytedance/seedance-2.0/us/reference-to-video' },
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['480p', '720p', '1080p', '4k'],
    perSecond: { '480p': 0.1406, '720p': 0.3024, '1080p': 0.7484, '4k': 1.5552 },
  },
  {
    id: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    hint: 'Quicker and cheaper; up to 720p',
    endpoints: { text: 'bytedance/seedance-2.0/fast/text-to-video', image: 'bytedance/seedance-2.0/fast/image-to-video', reference: 'bytedance/seedance-2.0/fast/reference-to-video' },
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    // fal lists 720p only; 480p from its token price ($0.0112 per 1,000 tokens) at Mini's 480p token count.
    perSecond: { '480p': 0.1154, '720p': 0.2419 },
  },
  {
    id: 'seedance-2.0-mini',
    label: 'Seedance 2.0 Mini',
    hint: 'Cheapest; drafts; up to 720p',
    endpoints: { text: 'bytedance/seedance-2.0/mini/text-to-video', image: 'bytedance/seedance-2.0/mini/image-to-video', reference: 'bytedance/seedance-2.0/mini/reference-to-video' },
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    perSecond: { '480p': 0.0721, '720p': 0.1547 },
  },
  {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    hint: 'Newest; clips up to 30 s; up to 1080p',
    endpoints: { text: 'bytedance/seedance-2.5/us/text-to-video', image: 'bytedance/seedance-2.5/us/image-to-video', reference: 'bytedance/seedance-2.5/us/reference-to-video' },
    minDuration: 4,
    maxDuration: 30,
    resolutions: ['480p', '720p', '1080p'],
    perSecond: { '480p': 0.2205, '720p': 0.473, '1080p': 1.164 },
  },
]).map((m) => ({ ...m, aspects: SEEDANCE_ASPECTS, maxReferences: 9, firstFrame: true, audio: true }));
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

  /** Submit, wait in the queue, and return the result. */
  const run = async (endpoint: string, input: Record<string, unknown>, signal?: AbortSignal, onStatus?: (s: string) => void) => {
    const submitted = await call(`${queue}/${endpoint}`, { method: 'POST', signal, body: JSON.stringify(input) });
    const id = submitted.request_id;
    if (!id) throw new Error('fal did not return a request');
    // Status and result live under the app (owner/alias), not the full endpoint path.
    const app = endpoint.split('/').slice(0, 2).join('/');
    const statusUrl: string = submitted.status_url ?? `${queue}/${app}/requests/${id}/status`;
    const resultUrl: string = submitted.response_url ?? `${queue}/${app}/requests/${id}`;
    const until = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
    for (;;) {
      const st = await call(statusUrl, { signal });
      if (st.status === 'COMPLETED') break;
      onStatus?.(st.status === 'IN_QUEUE' ? `In fal's queue${typeof st.queue_position === 'number' ? ` (${st.queue_position} ahead)` : ''}…` : 'Generating…');
      if (Date.now() > until) throw new Error('fal is taking too long; the request may still finish on fal');
      await sleep(opts.pollMs ?? 3000, signal);
    }
    return call(resultUrl, { signal });
  };
  return { key, run, fileUrl };
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

/**
 * Seedance clips through fal. With reference pictures it uses reference-to-video (the prompt
 * can call them @Image1, @Image2…, as the drama Seedance export writes it); with only a first
 * frame, image-to-video (a continuing shot); otherwise text-to-video.
 */
export function falVideoGenerator(opts: FalOptions & { model?: string } = {}): VideoGenerator {
  const fal = falClient(opts);
  return {
    id: 'fal',
    name: 'fal',
    site: 'https://fal.ai/models',
    models: FAL_VIDEO_MODELS.map(({ endpoints, perSecond, ...m }) => (void endpoints, void perSecond, m)),
    defaultModel: opts.model ?? 'seedance-2.0-fast',
    // The price depends only on the model, resolution and length (not the prompt, pictures or sound).
    estimate({ model, duration, resolution }) {
      const m = FAL_VIDEO_MODELS.find((x) => x.id === (model ?? opts.model ?? 'seedance-2.0-fast'));
      const rate = m && m.perSecond[nearest(m.resolutions, resolution, '720p')];
      if (!m || rate == null) return undefined;
      const seconds = Math.round(Math.min(m.maxDuration ?? 15, Math.max(m.minDuration ?? 4, duration ?? 5)));
      return { amount: Math.round(rate * seconds * 100) / 100, unit: 'USD', basis: FAL_PRICE_BASIS };
    },
    key: { help: 'From fal.ai → Dashboard → Keys. Kept in this browser only and sent only to fal. Billed by fal.', ...fal.key },
    async generate(req: VideoRequest) {
      const m = FAL_VIDEO_MODELS.find((x) => x.id === (req.model ?? opts.model)) ?? FAL_VIDEO_MODELS.find((x) => x.id === 'seedance-2.0-fast')!;
      const refs = (req.references ?? []).filter(Boolean).slice(0, m.maxReferences);
      const duration = Math.round(Math.min(m.maxDuration ?? 15, Math.max(m.minDuration ?? 4, req.duration ?? 5)));
      const base = {
        prompt: req.prompt,
        duration: String(duration),
        aspect_ratio: nearest(m.aspects, req.aspect, '16:9'),
        resolution: nearest(m.resolutions, req.resolution, '720p'),
        generate_audio: req.audio ?? false,
      };
      let endpoint: string;
      let input: Record<string, unknown>;
      req.onProgress?.(refs.length || req.firstFrame ? 'Sending pictures to fal…' : 'Sending to fal…');
      if (refs.length) {
        endpoint = m.endpoints.reference;
        input = { ...base, image_urls: await Promise.all(refs.map((r) => fal.fileUrl(r, req.signal))) };
      } else if (req.firstFrame) {
        endpoint = m.endpoints.image;
        input = { ...base, image_url: await fal.fileUrl(req.firstFrame, req.signal), ...(req.lastFrame ? { end_image_url: await fal.fileUrl(req.lastFrame, req.signal) } : {}) };
      } else {
        endpoint = m.endpoints.text;
        input = base;
      }
      const out = await fal.run(endpoint, input, req.signal, req.onProgress);
      const url = out?.video?.url;
      if (!url) throw new Error('fal returned no clip');
      return { videos: [url] };
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
    async estimate({ model } = {}) {
      const m = FAL_IMAGE_MODELS.find((x) => x.id === (model ?? opts.model)) ?? FAL_IMAGE_MODELS[0];
      return { credits: m.perImage, unit: 'USD', basis: FAL_PRICE_BASIS };
    },
    async generate({ prompt, aspect, model, references, signal, onProgress }) {
      const m = FAL_IMAGE_MODELS.find((x) => x.id === (model ?? opts.model)) ?? FAL_IMAGE_MODELS[0];
      const refs = (references ?? []).filter(Boolean).slice(0, 9);
      const input: Record<string, unknown> = { prompt, num_images: 1, aspect_ratio: nearest(IMAGE_ASPECTS, aspect, '1:1') };
      if (refs.length) input.image_urls = await Promise.all(refs.map((r) => fal.fileUrl(r, signal)));
      onProgress?.(10);
      const out = await fal.run(refs.length ? m.edit : m.id, input, signal, () => onProgress?.(50));
      const images = ((out?.images ?? []) as { url?: string }[]).map((i) => i.url).filter((u): u is string => !!u);
      if (!images.length) throw new Error('fal returned no picture');
      return { images };
    },
  };
}
