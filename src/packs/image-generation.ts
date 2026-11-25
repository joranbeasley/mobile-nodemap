/**
 * Image generation for `images` fields: a pluggable generator (text → pictures), and a Meshy
 * adapter. With a generator set, image fields offer ✨ Generate next to +, with a prompt
 * written from the card (see ImagesParamDef.prompt).
 *
 *   setImageGenerator(meshyImageGenerator({ key: { get: () => localStorage.getItem('k'), set: (v) => localStorage.setItem('k', v) } }));
 */

export interface ImageRequest {
  prompt: string;
  /** '1:1', '16:9', '9:16', '4:3', '3:4', '3:2' or '2:3'. */
  aspect?: string;
  model?: string;
  signal?: AbortSignal;
  /** 0–100 while it works. */
  onProgress?: (percent: number) => void;
}

export interface ImageResult {
  /** URLs of the generated pictures (they may expire: copy them, as the images field does). */
  images: string[];
  /** What the service charged, when it says. */
  credits?: number;
}

export interface ImageGenerator {
  id: string;
  /** Shown on the button and in messages, e.g. "Meshy". */
  name: string;
  models?: { id: string; label: string }[];
  defaultModel?: string;
  /** An API key the person gives once; the host decides where it is kept. */
  key?: { label: string; help?: string; get(): string | null | undefined; set(value: string): void };
  generate(req: ImageRequest): Promise<ImageResult>;
}

let current: ImageGenerator | null = null;

/** Turn on ✨ Generate in image fields (or off, with null). */
export function setImageGenerator(generator: ImageGenerator | null): void {
  current = generator;
}
export const getImageGenerator = (): ImageGenerator | null => current;

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

/**
 * Meshy text-to-image (POST /openapi/v1/text-to-image, then poll the task). Calls go from
 * the browser straight to Meshy with the person's own API key.
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
    const res = await doFetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(body.message || `Meshy said ${res.status}${res.status === 401 ? ': check your API key' : res.status === 402 ? ': not enough credits' : ''}`);
    return body;
  };
  return {
    id: 'meshy',
    name: 'Meshy',
    models: MESHY_IMAGE_MODELS,
    defaultModel: opts.model ?? 'nano-banana',
    key: { help: 'From meshy.ai → API. Kept in this browser only and sent only to Meshy.', ...key },
    async generate({ prompt, aspect, model, signal, onProgress }) {
      const aspect_ratio = nearestAspect(aspect);
      const created = await call('/openapi/v1/text-to-image', {
        method: 'POST',
        signal,
        body: JSON.stringify({ ai_model: model ?? opts.model ?? 'nano-banana', prompt, ...(aspect_ratio ? { aspect_ratio } : {}) }),
      });
      const id = created.result ?? created.id;
      if (!id) throw new Error('Meshy did not return a task');
      const until = Date.now() + (opts.timeoutMs ?? 180_000);
      for (;;) {
        const task = await call(`/openapi/v1/text-to-image/${encodeURIComponent(id)}`, { signal });
        onProgress?.(Number(task.progress ?? 0));
        if (task.status === 'SUCCEEDED') return { images: (task.image_urls ?? []) as string[], credits: task.consumed_credits };
        if (['FAILED', 'CANCELED', 'EXPIRED'].includes(task.status)) throw new Error(task.task_error?.message || `Meshy task ${String(task.status).toLowerCase()}`);
        if (Date.now() > until) throw new Error('Meshy is taking too long; try again later');
        await sleep(opts.pollMs ?? 2000, signal);
      }
    },
  };
}
