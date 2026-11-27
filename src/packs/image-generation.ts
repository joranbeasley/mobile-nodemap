/**
 * Image generation for `images` fields: a pluggable generator (text, and optionally reference
 * pictures → pictures), and a Meshy adapter. With a generator set, image fields offer ✨ Generate next to +, with a prompt
 * written from the card (see ImagesParamDef.prompt).
 *
 *   setImageGenerator(meshyImageGenerator({ key: { get: () => localStorage.getItem('k'), set: (v) => localStorage.setItem('k', v) } }));
 */

export interface ImageRequest {
  prompt: string;
  /** '1:1', '16:9', '9:16', '4:3', '3:4', '3:2' or '2:3'. */
  aspect?: string;
  model?: string;
  /**
   * Pictures to work from, most important first: https URLs or data: URIs (PNG, JPEG or WebP).
   * Only for generators with `maxReferences`; at most that many are sent.
   */
  references?: string[];
  signal?: AbortSignal;
  /** 0–100 while it works. */
  onProgress?: (percent: number) => void;
}

export interface ImageResult {
  /** URLs of the generated pictures (they may expire: copy them, as the images field does). */
  images: string[];
  /** What it cost: from the service, or measured from the balance before and after. */
  credits?: number;
  /** Credits left afterwards, when the service says. */
  balance?: number;
}

/** What a picture will probably cost, and why we think so. */
export interface ImageEstimate {
  credits: number;
  /** e.g. "what your last one cost" */
  basis: string;
}

/** A picture the service already has (an earlier generation or a 3D model's thumbnail). */
export interface ImageAsset {
  id: string;
  /** Its prompt or name. */
  label: string;
  /** What it is, e.g. "Picture · 3 days ago" or "3D model". */
  hint?: string;
  /** A small preview. */
  thumb: string;
  /** The picture to add. */
  url: string;
}

export interface ImageGenerator {
  id: string;
  /** Shown on the button and in messages, e.g. "Meshy". */
  name: string;
  models?: { id: string; label: string }[];
  defaultModel?: string;
  /** How many reference pictures `generate` accepts (0 or unset: text only). */
  maxReferences?: number;
  /** An API key the person gives once; the host decides where it is kept. */
  key?: { label: string; help?: string; get(): string | null | undefined; set(value: string): void };
  generate(req: ImageRequest): Promise<ImageResult>;
  /** Credits left on the account. */
  balance?(opts?: { signal?: AbortSignal }): Promise<number | undefined>;
  /** What a picture with this model (and this many references) will probably cost; undefined when unknown. */
  estimate?(req: { model?: string; references?: number; signal?: AbortSignal }): Promise<ImageEstimate | undefined>;
  /** Where to make pictures by hand when this page can't reach the service (offered with the prompt). */
  site?: string;
  /** The person's existing pictures on the service, newest first, to search and reuse. */
  browse?(opts?: { signal?: AbortSignal }): Promise<ImageAsset[]>;
}

let generators: ImageGenerator[] = [];

/** Turn on ✨ Generate in image fields with one generator (or off, with null). */
export function setImageGenerator(generator: ImageGenerator | null): void {
  generators = generator ? [generator] : [];
}
/** Several generators: the ✨ panel offers a choice, remembering the last one used. */
export function setImageGenerators(list: ImageGenerator[]): void {
  generators = [...list];
}
/** The first (default) generator. */
export const getImageGenerator = (): ImageGenerator | null => generators[0] ?? null;
export const getImageGenerators = (): ImageGenerator[] => generators;

/** Aspect ratios Meshy accepts; others are mapped to the nearest. */
const MESHY_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
const nearestAspect = (a?: string) => {
  if (!a || MESHY_ASPECTS.includes(a)) return a;
  const [w, h] = a.split(':').map(Number);
  if (!w || !h) return undefined;
  const r = w / h;
  return MESHY_ASPECTS.map((x) => [x, x.split(':').map(Number)] as const).sort((p, q) => Math.abs(p[1][0] / p[1][1] - r) - Math.abs(q[1][0] / q[1][1] - r))[0][0];
};

export const MESHY_IMAGE_MODELS = [
  { id: 'nano-banana', label: 'Nano Banana' },
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
  { id: 'gpt-image-2', label: 'GPT Image 2' },
];

/** Reference pictures Meshy's image-to-image takes per request. */
export const MESHY_MAX_REFERENCES = 5;

/**
 * Meshy text-to-image (POST /openapi/v1/text-to-image, then poll the task), or image-to-image
 * when the request has reference pictures (POST /openapi/v1/image-to-image with
 * `reference_image_urls`: up to 5 https URLs or data: URIs). Calls go from the browser
 * straight to Meshy with the person's own API key.
 */
export function meshyImageGenerator(
  opts: {
    key?: ImageGenerator['key'];
    /** A fixed key instead (servers, tests). */
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    pollMs?: number;
    timeoutMs?: number;
    fetch?: typeof fetch;
  } = {},
): ImageGenerator {
  const base = (opts.baseUrl ?? 'https://api.meshy.ai').replace(/\/$/, '');
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let memoryKey = '';
  /** Costs seen in this session, by "kind|model". */
  const measured = new Map<string, number>();
  let history: { at: number; rows: Record<string, any>[] } | undefined;
  const key = opts.key ?? { label: 'Meshy API key', get: () => opts.apiKey ?? memoryKey, set: (v: string) => void (memoryKey = v) };
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Cancelled', 'AbortError'));
      });
    });
  const call = async (path: string, init: RequestInit = {}) => {
    const k = key.get();
    if (!k) throw new Error('Add your Meshy API key first');
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      // A network-level failure: the page's host (e.g. a sandboxed artifact) or the browser blocked it.
      throw Object.assign(new Error("This page can't reach Meshy: where it is open, calls to other sites are blocked. Copy the prompt and make the picture on meshy.ai, then add it with +."), { code: 'blocked' });
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(body.message || `Meshy said ${res.status}${res.status === 401 ? ': check your API key' : res.status === 402 ? ': not enough credits' : ''}`);
    return body;
  };
  return {
    id: 'meshy',
    name: 'Meshy',
    site: 'https://www.meshy.ai/',
    models: MESHY_IMAGE_MODELS,
    defaultModel: opts.model ?? 'nano-banana',
    maxReferences: MESHY_MAX_REFERENCES,
    key: { help: 'From meshy.ai → API. Kept in this browser only and sent only to Meshy.', ...key },
    async browse({ signal } = {}) {
      // Pictures from text-to-image, and the thumbnails of 3D models (all newest first).
      const list = async (path: string) => {
        try {
          const rows = await call(`${path}?page_size=50&sort_order=desc`, { signal });
          return Array.isArray(rows) ? (rows as Record<string, any>[]).filter((r) => r.status === 'SUCCEEDED') : [];
        } catch (err) {
          if ((err as Error).name === 'AbortError' || (err as { code?: string }).code === 'blocked' || /API key/.test((err as Error).message)) throw err;
          return [];
        }
      };
      const ago = (t?: number) => {
        if (!t) return '';
        const days = Math.floor((Date.now() - t) / 86_400_000);
        return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      };
      const [images, t3d, i3d, m3d] = await Promise.all([
        list('/openapi/v1/text-to-image'),
        list('/openapi/v2/text-to-3d'),
        list('/openapi/v1/image-to-3d'),
        list('/openapi/v1/multi-image-to-3d'),
      ]);
      const out: (ImageAsset & { t: number })[] = [];
      for (const r of images)
        (r.image_urls ?? []).forEach((url: string, i: number) =>
          out.push({ id: `${r.id}:${i}`, label: String(r.prompt ?? 'Picture'), hint: ['Picture', ago(r.finished_at ?? r.created_at)].filter(Boolean).join(' · '), thumb: url, url, t: r.created_at ?? 0 }),
        );
      for (const r of [...t3d, ...i3d, ...m3d])
        if (r.thumbnail_url)
          out.push({
            id: String(r.id),
            label: String(r.name || r.prompt || r.object_prompt || r.texture_prompt || '3D model'),
            hint: ['3D model', ago(r.finished_at ?? r.created_at)].filter(Boolean).join(' · '),
            thumb: r.thumbnail_url,
            url: r.thumbnail_url,
            t: r.created_at ?? 0,
          });
      return out.sort((a, b) => b.t - a.t).map(({ t, ...a }) => (void t, a));
    },
    async balance({ signal } = {}) {
      const b = await call('/openapi/v1/balance', { signal });
      return typeof b.balance === 'number' ? b.balance : undefined;
    },
    async estimate({ model, references, signal } = {}) {
      const kind = references ? 'image-to-image' : 'text-to-image';
      const m = model ?? opts.model ?? 'nano-banana';
      const seen = measured.get(`${kind}|${m}`);
      if (seen != null) return { credits: seen, basis: 'what your last one cost' };
      // Otherwise what Meshy recorded for your most recent picture like it.
      if (!history || Date.now() - history.at > 60_000) {
        try {
          const rows = await call('/openapi/v1/text-to-image?page_size=50&sort_order=desc', { signal });
          history = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
          return undefined;
        }
      }
      // A recorded 0 isn't trustworthy (pictures made on meshy.ai often show 0): treat it as
      // unknown, and let the balance measure the real cost of the next one.
      const last = history.rows.find((r) => r.status === 'SUCCEEDED' && r.ai_model === m && (r.type ?? 'text-to-image') === kind && r.consumed_credits > 0);
      return last ? { credits: last.consumed_credits, basis: 'what Meshy recorded for your last one' } : undefined;
    },
    async generate({ prompt, aspect, model, references, signal, onProgress }) {
      const aspect_ratio = nearestAspect(aspect);
      const refs = (references ?? []).filter(Boolean).slice(0, MESHY_MAX_REFERENCES);
      const kind = refs.length ? 'image-to-image' : 'text-to-image';
      const ai_model = model ?? opts.model ?? 'nano-banana';
      // The balance before and after tells us what it really cost (Meshy doesn't always say).
      const balanceNow = async () => {
        try {
          return (await call('/openapi/v1/balance', { signal })).balance as number | undefined;
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
          return undefined;
        }
      };
      const before = await balanceNow();
      const created = await call(`/openapi/v1/${kind}`, {
        method: 'POST',
        signal,
        body: JSON.stringify({
          ai_model,
          prompt,
          ...(aspect_ratio ? { aspect_ratio } : {}),
          ...(refs.length ? { reference_image_urls: refs } : {}),
        }),
      });
      const id = created.result ?? created.id;
      if (!id) throw new Error('Meshy did not return a task');
      const until = Date.now() + (opts.timeoutMs ?? 180_000);
      for (;;) {
        const task = await call(`/openapi/v1/${kind}/${encodeURIComponent(id)}`, { signal });
        onProgress?.(Number(task.progress ?? 0));
        if (task.status === 'SUCCEEDED') {
          const after = await balanceNow();
          const diff = before != null && after != null && before >= after ? before - after : undefined;
          const reported = typeof task.consumed_credits === 'number' ? task.consumed_credits : undefined;
          const credits = reported ? reported : diff ?? reported;
          if (credits != null) measured.set(`${kind}|${ai_model}`, credits);
          history = undefined;
          return { images: (task.image_urls ?? []) as string[], credits, balance: after };
        }
        if (['FAILED', 'CANCELED', 'EXPIRED'].includes(task.status)) throw new Error(task.task_error?.message || `Meshy task ${String(task.status).toLowerCase()}`);
        if (Date.now() > until) throw new Error('Meshy is taking too long; try again later');
        await sleep(opts.pollMs ?? 2000, signal);
      }
    },
  };
}
