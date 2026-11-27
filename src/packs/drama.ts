import { defineNode, definePack, type GraphEngine } from '../core/registry.js';
import type { Graph } from '../core/graph.js';
import type { ChooseOptions, NodeInstance, NodeResult, NodeType, ParamKind, PortTypeDef } from '../core/types.js';
import { saveDramaFile, seedancePack, seedanceScript } from './drama-seedance.js';
import { getImageGenerators, type ImageGenerator } from './image-generation.js';
import { getVideoGenerators, type VideoGenerator, type VideoJob } from './video-generation.js';

/** Work in progress on a picture or clip: what it's doing, the percent when the service says, and since when. */
interface Pending {
  text: string;
  percent?: number;
  since: number;
}
const elapsed = (since: number) => {
  const sec = Math.max(0, Math.round((Date.now() - since) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
let ticker: ReturnType<typeof setInterval> | undefined;
/** One clock for every placeholder on the page: elapsed times tick each second. */
function tick() {
  if (ticker) return;
  ticker = setInterval(() => {
    const clocks = document.querySelectorAll<HTMLElement>('.dr-pending [data-since]');
    if (!clocks.length) {
      clearInterval(ticker);
      ticker = undefined;
      return;
    }
    clocks.forEach((c) => (c.textContent = elapsed(Number(c.dataset.since))));
  }, 1000);
}
/**
 * A placeholder where a picture (`dr-thumb`) or clip (`dr-clip-tile`) is being made: a ring or bar
 * filled to the percent when the service reports one (Meshy does), else moving, with the time so far.
 */
function pendingTile(cls: string, p: Pending): HTMLElement {
  const pc = typeof p.percent === 'number' && p.percent > 0 ? Math.max(1, Math.min(99, Math.round(p.percent))) : undefined;
  const t = document.createElement('div');
  t.className = `dr-pending ${cls}${pc == null ? ' dr-indeterminate' : ''}`;
  t.setAttribute('role', 'status');
  t.setAttribute('aria-label', `${p.text}${pc != null ? ` ${pc}%` : ''}`);
  t.title = p.text;
  t.style.setProperty('--pc', String(pc ?? 0));
  const span = (c: string, text = '') => Object.assign(document.createElement('span'), { className: c, textContent: text });
  const clock = span('dr-pending-time', elapsed(p.since));
  clock.dataset.since = String(p.since);
  t.append(span('dr-pending-meter'), span('dr-pending-pc', pc != null ? `${pc}%` : ''), span('dr-pending-label', p.text), clock);
  tick();
  return t;
}

/**
 * Where finished clips are kept. A service's links expire, and pages often can't read videos from
 * another site (so the last frame can't be taken): a host can copy each clip somewhere of its own
 * and return that URL. Without one, the service's link is used as it is.
 */
type ClipKeeper = (url: string, info: { shotId: string }) => Promise<string>;
let clipKeeper: ClipKeeper | null = null;
export function setClipKeeper(fn: ClipKeeper | null): void {
  clipKeeper = fn;
}

/**
 * The ⇄ switch on a reference from a card with several pictures: pick which one to send. The
 * choice is remembered on the node being generated for (`referencePicks`, card → picture).
 */
function referenceSwitch(r: Reference, ctx: { node: NodeInstance; graph: Graph; choose?: (o: ChooseOptions) => Promise<string | undefined> }, onPick: (src: string) => void): HTMLElement | undefined {
  const choices = r.choices;
  if (!r.card || !choices || choices.length < 2) return undefined;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dr-gen-pick';
  const label = () => {
    const i = choices.indexOf(r.src);
    b.textContent = `⇄ ${i + 1}/${choices.length}`;
    b.setAttribute('aria-label', `Choose which of ${choices.length} pictures to send for ${r.label}`);
  };
  label();
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    let next: string | undefined;
    if (ctx.choose) {
      const id = await ctx.choose({
        title: `Which picture for ${r.label}?`,
        items: choices.map((src, i) => ({ id: String(i), label: `Picture ${i + 1}`, hint: src === r.src ? 'sending this one' : undefined, image: src })),
      });
      if (id !== undefined) next = choices[Number(id)];
    } else next = choices[(choices.indexOf(r.src) + 1) % choices.length];
    if (!next || next === r.src) return;
    onPick(next);
    label();
    const node = ctx.graph.nodes.get(ctx.node.id);
    if (node) ctx.graph.setParam(node.id, 'referencePicks', { ...((node.params.referencePicks as Record<string, string>) ?? {}), [r.card!]: next });
  });
  return b;
}

/** Service links already offered to the keeper on this page. */
const keepTried = new Set<string>();

/** Clips being collected right now (shot id + job start), so redraws don't ask twice. */
const collecting = new Set<string>();

/** The generator people last chose (per kind), remembered in this browser. */
function preferred<T extends { id: string }>(kind: string, list: T[]): T | null {
  let id = '';
  try {
    id = localStorage.getItem(`nodemap:${kind}-generator`) ?? '';
  } catch {
    /* private mode */
  }
  return list.find((g) => g.id === id) ?? list[0] ?? null;
}
function remember(kind: string, id: string) {
  try {
    localStorage.setItem(`nodemap:${kind}-generator`, id);
  } catch {
    /* private mode */
  }
}

/**
 * Drama productions: a cast of characters, locations and props feed shots; shots make up
 * numbered scenes, scenes make up episodes and episodes make up seasons. Wires flow from the
 * pieces to what they make up, so a tidy map reads left to right: cast → shots → scenes →
 * episodes. An engine works out who is in which scene, sluglines, running times and a
 * printable shot list.
 */

// ------------------------------------------------------------------ types

export const DRAMA = {
  location: 'drama-location',
  character: 'drama-character',
  prop: 'drama-prop',
  costume: 'drama-costume',
  shot: 'drama-shot',
  scene: 'drama-scene',
  episode: 'drama-episode',
} as const;

const portTypes: PortTypeDef[] = [
  { id: DRAMA.location, label: 'Location', color: '#2f9e44', inline: false },
  { id: DRAMA.character, label: 'Character', color: '#e8590c', inline: false },
  { id: DRAMA.prop, label: 'Prop', color: '#ae3ec9', inline: false },
  { id: DRAMA.costume, label: 'Costume', color: '#d6336c', inline: false },
  { id: DRAMA.shot, label: 'Shot', color: '#1971c2', inline: false },
  { id: DRAMA.scene, label: 'Scene', color: '#5f3dc4', inline: false },
  { id: DRAMA.episode, label: 'Episode', color: '#c2255c', inline: false },
];

export const FRAMINGS = ['Wide', 'Full', 'Medium', 'Close-up', 'Extreme close-up', 'Two-shot', 'Over the shoulder', 'Point of view', 'Insert'];
export const MOVES = ['Static', 'Pan', 'Tilt', 'Dolly', 'Tracking', 'Handheld', 'Crane', 'Zoom'];
export const TIMES = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'CONTINUOUS', 'LATER'];

// ------------------------------------------------------------------ images

/** Image lists are arrays of URLs (data: URLs for photos added on the device). */
export const imageList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

/** Shrink a photo to at most `max` px on its long side and re-encode it, so maps stay small. */
export async function imageFileToDataUrl(file: Blob, max = 1024, quality = 0.8): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A picture ready to send to an image generator as a reference: PNG, JPEG and WebP data URLs
 * and web links go as they are; anything else (SVG drawings, very large pictures) is drawn
 * onto a canvas and sent as a JPEG, at most `max` px on its long side.
 */
export async function referencePicture(src: string, max = 1024): Promise<string> {
  if (/^https?:/i.test(src)) return src;
  if (/^data:image\/(png|jpe?g|webp)[;,]/i.test(src) && src.length < 1_500_000) return src;
  const img = new Image();
  img.src = src;
  await img.decode();
  // SVGs without a size report 0 (or a small default): scale them up to the full size.
  const w = img.naturalWidth || max;
  const h = img.naturalHeight || Math.round(max * 0.75);
  const k = /^data:image\/svg/i.test(src) ? max / Math.max(w, h) : Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; // SVGs and PNGs may be transparent; JPEG isn't
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

/** A full-screen viewer: tap the sides to step through, anywhere else (or Escape) to close. */
export function openLightbox(images: string[], start = 0, caption?: string): void {
  if (!images.length) return;
  let i = start;
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', caption ?? 'Images');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;touch-action:none;';
  const img = document.createElement('img');
  img.style.cssText = 'max-width:100%;max-height:calc(100% - 48px);object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5);';
  const cap = document.createElement('div');
  cap.style.cssText = 'color:#fff;font:13px system-ui,sans-serif;opacity:.85;text-align:center;';
  const show = () => {
    img.src = images[i];
    img.alt = `${caption ?? 'Image'} ${i + 1}`;
    cap.textContent = `${caption ? `${caption} · ` : ''}${i + 1} / ${images.length}${images.length > 1 ? ' · tap the sides to browse' : ''}`;
  };
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey);
  };
  const step = (d: number) => {
    i = (i + d + images.length) % images.length;
    show();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  };
  box.addEventListener('click', (e) => {
    const x = e.clientX / window.innerWidth;
    if (images.length > 1 && x < 0.25) step(-1);
    else if (images.length > 1 && x > 0.75) step(1);
    else close();
  });
  document.addEventListener('keydown', onKey);
  box.append(img, cap);
  show();
  document.body.append(box);
}

/**
 * Param kind `images`: thumbnails with a remove button, tap to view full screen, and an Add
 * button that takes photos from the camera or library (shrunk before they are stored).
 *   { name: 'images', kind: 'images', max: 12 }
 */
/**
 * The last frame of a video (a finished clip), as a JPEG data URL at most `max` px on its long
 * side. Runs in the browser: the video is opened locally and never uploaded or stored.
 */
export async function lastFrameOf(file: Blob, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  const once = (ev: string) =>
    new Promise<void>((resolve, reject) => {
      const done = () => (v.removeEventListener(ev, done), v.removeEventListener('error', fail), resolve());
      const fail = () => (v.removeEventListener(ev, done), v.removeEventListener('error', fail), reject(new Error('This browser can’t open that video')));
      v.addEventListener(ev, done);
      v.addEventListener('error', fail);
    });
  try {
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const loaded = once('loadedmetadata');
    v.src = url;
    await loaded;
    // Some files only know their length after a seek to the end.
    if (!Number.isFinite(v.duration)) {
      const s = once('seeked');
      v.currentTime = 1e9;
      await s;
    }
    const seeked = once('seeked');
    v.currentTime = Math.max(0, v.duration - 0.05);
    await seeked;
    const k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(v.videoWidth * k));
    c.height = Math.max(1, Math.round(v.videoHeight * k));
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** What 🎬 Generate clip starts from for a shot: its Seedance prompt, pictures and settings. */
export interface ShotClipSuggestion {
  prompt: string;
  /** In order: the prompt calls them @Image1, @Image2… */
  references: Reference[];
  /** The previous clip's last frame, for a shot that carries on from it. */
  firstFrame?: string;
  duration: number;
  aspect: string;
}
type ClipSuggester = (graph: Graph, shotId: string) => ShotClipSuggestion | undefined;
/**
 * Set by the Seedance export (it writes the prompt). Kept on the function itself: that module
 * and this one import each other, and a function declaration exists before either has run.
 */
export function setShotClipSuggester(fn: ClipSuggester): void {
  (setShotClipSuggester as unknown as { fn?: ClipSuggester }).fn = fn;
}
export function shotClipSuggestion(graph: Graph, shotId: string): ShotClipSuggestion | undefined {
  return (setShotClipSuggester as unknown as { fn?: ClipSuggester }).fn?.(graph, shotId);
}

/**
 * A shot's finished clip, kept as its last frame (a data URL): the next shot can start from it
 * (when it continues this one) or match it (continuity). Pick the video and the frame is taken
 * in the browser; the video itself is not stored.
 */
export const clipFrameParam: ParamKind = {
  kind: 'clipframe',
  render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'dr-clip';
    let value = typeof ctx.value === 'string' ? ctx.value : '';
    const status = document.createElement('small');
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'video/*', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      status.textContent = 'Taking the last frame…';
      try {
        value = await lastFrameOf(file);
        ctx.set(value);
        draw();
      } catch (err) {
        status.textContent = (err as Error).message;
      }
    });
    const button = (text: string, aria: string, fn: () => void, cls = 'dr-clip-btn') => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: text });
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      return b;
    };
    const draw = () => {
      wrap.replaceChildren(input);
      if (value) {
        const view = button('', 'View the last frame', () => openLightbox([value], 0, 'Last frame of the finished clip'), 'dr-clip-thumb');
        view.append(Object.assign(document.createElement('img'), { src: value, alt: '' }));
        const note = Object.assign(document.createElement('small'), { textContent: 'Last frame of the finished clip' });
        wrap.append(view, note, button('Replace…', 'Replace the clip', () => input.click()), button('×', 'Remove the clip', () => ((value = ''), ctx.set(''), draw())));
      } else {
        wrap.append(button('🎞 Add finished clip…', 'Add the finished clip', () => input.click()));
      }
      const url = ctx.graph.nodes.get(ctx.node.id)?.params.clipUrl;
      if (typeof url === 'string' && url) {
        // The clip itself, playable in the card (playing needs no permission from the other site).
        const video = Object.assign(document.createElement('video'), { src: url, controls: true, playsInline: true, preload: 'metadata', className: 'dr-clip-video' });
        video.dataset.nmLive = ''; // plays before the card is selected
        if (value) video.poster = value;
        const save = Object.assign(document.createElement('a'), { href: url, download: 'clip.mp4', target: '_blank', rel: 'noopener', className: 'dr-clip-btn dr-clip-watch', textContent: '⬇ Download' });
        wrap.append(video, save);
      }
      const job = jobOf();
      if (making || job) wrap.append(pendingTile('dr-clip-tile', making ?? { text: `Generating on ${job!.service}`, since: job!.startedAt }));
      if (job) {
        const since = new Date(job.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        wrap.append(
          Object.assign(document.createElement('span'), { className: 'dr-clip-job', textContent: `⏳ Generating on ${job.service} since ${since}` }),
          button('Check now', 'Check on the clip being generated', () => void collectJob()),
          button('Forget', 'Stop waiting for this clip', () => {
            ctx.graph.setParam(ctx.node.id, 'clipJob', null);
            status.textContent = 'Stopped waiting. If it finishes, it stays in your account on the service.';
            draw();
          }),
        );
      } else if (getVideoGenerators().length) wrap.append(button('🎬 Generate clip', 'Generate a clip for this shot', () => openGen()));
      wrap.append(status);
      if (panel) wrap.append(panel);
    };

    // A clip being generated is kept on the shot (clipJob) until it's collected, so a closed
    // page, a sleeping phone or another device can still pick it up.
    const jobOf = (): VideoJob | undefined => {
      const j = ctx.graph.nodes.get(ctx.node.id)?.params.clipJob as VideoJob | null | undefined;
      return j && typeof j === 'object' && typeof j.service === 'string' ? j : undefined;
    };
    /** A finished clip: keep its link and its last frame, and forget the job. */
    const collect = async (clip: string, spent: string, signal?: AbortSignal) => {
      // Keep a copy where the host says (it lasts, and this page can read it), else the service's link.
      let kept = clip;
      let copied = false;
      if (clipKeeper) {
        status.textContent = 'Saving a copy of the clip…';
        try {
          kept = await clipKeeper(clip, { shotId: ctx.node.id });
          copied = kept !== clip;
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
        }
      }
      // The clip first, then forget the job: the shot is never without either (its card shows the field while it has one).
      ctx.graph.setParam(ctx.node.id, 'clipUrl', kept);
      ctx.graph.setParam(ctx.node.id, 'clipJob', null);
      draw();
      try {
        value = await lastFrameOf(await (await fetch(kept, { signal, credentials: 'same-origin' })).blob());
        ctx.set(value);
        status.textContent = `Clip ready${spent ? ` · ${spent}` : ''}.${copied ? '' : ' Its link may expire: download it to keep it.'}`;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        status.textContent = `Clip ready${spent ? ` · ${spent}` : ''}. Its last frame couldn’t be taken here: download it and add it with 🎞.`;
      }
      draw();
    };
    /** Ask the service about a clip sent earlier, and collect it if it's done. */
    const collectJob = async () => {
      const job = jobOf();
      if (!job) return;
      const gen = getVideoGenerators().find((g) => g.id === job.service);
      if (!gen?.resume) return void (status.textContent = `This clip is being made on ${job.service}, which isn't set up here.`);
      if (gen.key && !gen.key.get()) return void (status.textContent = `Add your ${gen.key.label} to collect this clip.`);
      const k = `${ctx.node.id}:${job.startedAt}`;
      if (collecting.has(k)) return;
      collecting.add(k);
      status.textContent = '';
      making = { text: 'Checking on the clip…', since: job.startedAt };
      draw();
      try {
        const r = await gen.resume(job, { onProgress: (t, pc) => progress(t, pc) });
        if (!r.videos[0]) throw new Error(`${gen.name} returned no clip`);
        await collect(r.videos[0], r.cost ?? '');
      } catch (err) {
        if ((err as { code?: string }).code === 'pending') status.textContent = (err as Error).message;
        else {
          ctx.graph.setParam(ctx.node.id, 'clipJob', null);
          status.textContent = `The clip didn't finish on ${gen.name}: ${(err as Error).message}`;
        }
      } finally {
        collecting.delete(k);
        making = undefined;
        if (wrap.isConnected) draw();
      }
    };
    // Check when the shot is shown, and again when the page comes back from the background.
    const onVisible = () => {
      if (!wrap.isConnected) return document.removeEventListener('visibilitychange', onVisible);
      if (document.visibilityState === 'visible' && jobOf()) void collectJob();
    };
    document.addEventListener('visibilitychange', onVisible);
    queueMicrotask(() => {
      if (jobOf()) return void collectJob();
      const url = ctx.graph.nodes.get(ctx.node.id)?.params.clipUrl;
      const here = typeof location !== 'undefined' ? location.origin : '';
      const away = typeof url === 'string' && /^https?:\/\//i.test(url) && !url.startsWith(here);
      // Once per clip per page visit: a link that can't be kept (expired, say) isn't retried on every redraw.
      if (clipKeeper && away && !keepTried.has(url as string)) {
        keepTried.add(url as string);
        void collect(url as string, '').catch(() => undefined);
      }
    });

    // 🎬 Generate clip: the shot's own Seedance prompt and pictures, sent to a video service.
    let panel: HTMLElement | undefined;
    /** The clip being made, shown as a placeholder in the field. */
    let making: Pending | undefined;
    const progress = (text: string, percent?: number) => {
      if (!making) return;
      making = { ...making, text, percent: percent ?? making.percent };
      if (wrap.isConnected) draw();
    };
    let chosen: VideoGenerator | null = preferred('video', getVideoGenerators());
    let abort: AbortController | undefined;
    const el = (tag: string, attrs: Record<string, string> = {}, text = '') => {
      const x = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
      if (text) x.textContent = text;
      return x;
    };
    const openGen = () => {
      if (panel) {
        abort?.abort();
        panel = undefined;
        return draw();
      }
      const gen = chosen;
      if (!gen) return;
      const p = ctx.param as { video?: (node: NodeInstance, graph: Graph) => ShotClipSuggestion | undefined };
      let s: ShotClipSuggestion | undefined;
      try {
        s = p.video?.(ctx.node, ctx.graph);
      } catch {
        s = undefined;
      }
      const box = el('div', { class: 'dr-gen-panel dr-clip-panel', role: 'group', 'aria-label': `Generate a clip with ${gen.name}` });
      const row = (...kids: Node[]) => {
        const r = el('div', { class: 'dr-gen-row' });
        r.append(...kids);
        return r;
      };
      const select = (label: string, options: { value: string; text: string }[], value?: string) => {
        const x = el('select', { 'aria-label': label }) as HTMLSelectElement;
        for (const o of options) x.append(Object.assign(document.createElement('option'), { value: o.value, textContent: o.text }));
        if (value && options.some((o) => o.value === value)) x.value = value;
        return x;
      };
      const gens = getVideoGenerators();
      if (gens.length > 1) {
        const service = select('Service', gens.map((g) => ({ value: g.id, text: g.name })), gen.id);
        service.addEventListener('change', () => {
          chosen = gens.find((g) => g.id === service.value) ?? gen;
          remember('video', chosen.id);
          panel = undefined;
          openGen();
        });
        box.append(row(el('small', {}, 'Service'), service));
      }
      const model = select('Model', gen.models.map((m) => ({ value: m.id, text: m.label })), gen.defaultModel);
      const hint = el('small', { class: 'dr-gen-refs-note' });
      const dur = el('input', { type: 'number', 'aria-label': 'Seconds', step: '1' }) as HTMLInputElement;
      const aspect = select('Aspect ratio', [], '');
      const res = select('Resolution', [], '');
      const audio = el('input', { type: 'checkbox', 'aria-label': 'With sound' }) as HTMLInputElement;
      const current = () => gen.models.find((x) => x.id === model.value) ?? gen.models[0];
      // A length the model takes: in its range, and one of its lengths when it has a list.
      const snap = (m: (typeof gen.models)[number] | undefined, want: number) => {
        const d = Math.min(m?.maxDuration ?? 60, Math.max(m?.minDuration ?? 1, want));
        return m?.durations?.length ? m.durations.reduce((a, b) => (Math.abs(b - d) <= Math.abs(a - d) ? b : a)) : Math.round(d);
      };
      // Reference pictures switched on (set once the strip is built).
      let refsOn = () => 0;
      const fit = () => {
        const m = current();
        hint.textContent = m?.hint ?? '';
        dur.min = String(m?.minDuration ?? 1);
        dur.max = String(m?.maxDuration ?? 60);
        dur.value = String(snap(m, Number(dur.value) || s?.duration || 5));
        const keep = (x: HTMLSelectElement, values: string[] | undefined, want: string) => {
          const cur = x.value || want;
          x.replaceChildren(...(values ?? [want]).map((v) => Object.assign(document.createElement('option'), { value: v, textContent: v })));
          x.value = (values ?? [want]).includes(cur) ? cur : (values ?? [want]).includes(want) ? want : (values ?? [want])[0];
        };
        keep(aspect, m?.aspects, s?.aspect ?? '16:9');
        keep(res, m?.resolutions, '720p');
        audio.disabled = !m?.audio;
      };
      // What it will cost: the model, resolution and length decide it (not the prompt).
      const price = el('small', { class: 'dr-gen-cost', role: 'status' });
      const money = (e: { amount: number; unit: string }) => (e.unit === 'USD' ? `$${e.amount.toFixed(2)}` : `${e.amount} credits`);
      const quote = () => gen.estimate?.({ model: model.value, duration: Number(dur.value), resolution: res.value, aspect: aspect.value, audio: audio.checked && !audio.disabled, references: refsOn() });
      // What the model will do with the pictures switched on, when it takes fewer.
      const limits = el('small', { class: 'dr-gen-refs-note dr-gen-limit' });
      const showPrice = () => {
        const e = quote();
        price.textContent = e ? `About ${money(e)} for ${e.seconds ?? dur.value} s at ${res.value}${audio.checked && !audio.disabled ? ' with sound' : ''} (${e.basis})` : '';
        const m = current();
        const max = m?.maxReferences ?? 0;
        const n = refsOn();
        limits.textContent = !n || n <= max ? '' : max === 0 ? `${m?.label ?? 'This model'} takes no reference pictures: it gets the prompt only (and a continuing shot’s first frame).` : `${m?.label ?? 'This model'} takes up to ${max} reference pictures: the first ${max} switched on are sent.`;
      };
      model.addEventListener('change', () => (fit(), showPrice()));
      dur.addEventListener('change', () => ((dur.value = String(snap(current(), Number(dur.value) || 5))), showPrice()));
      for (const x of [res, aspect, audio]) x.addEventListener('change', showPrice);
      dur.addEventListener('input', showPrice);
      fit();
      showPrice();
      const sound = el('label', { class: 'dr-clip-sound' });
      sound.append(audio, ' sound');
      const secs = el('label', { class: 'dr-clip-dur' });
      secs.append(dur, ' s');
      box.append(row(model, secs, aspect, res, sound), hint, price, limits);
      const prompt = el('textarea', { rows: '6', 'aria-label': 'Clip prompt', placeholder: 'Describe the shot' }) as HTMLTextAreaElement;
      prompt.value = s?.prompt ?? '';
      box.append(prompt);
      // The shot's pictures, in the export's order (the prompt calls them @Image1…): all on.
      const refs = s?.references ?? [];
      const on = new Set(refs.map((r) => r.src));
      if (refs.length) {
        const strip = el('div', { class: 'dr-gen-refs', role: 'group', 'aria-label': 'Reference pictures' });
        // A card's first reference is its main picture (it gets the ⇄ switch); any others are extra views.
        const views = new Map<string, { r: Reference; b: HTMLButtonElement; im: HTMLImageElement }[]>();
        refs.forEach((r, i) => {
          const b = el('button', { type: 'button', class: 'dr-gen-ref', title: r.label, 'aria-label': r.label, 'aria-pressed': 'true' }) as HTMLButtonElement;
          const im = el('img', { src: r.src, alt: '' }) as HTMLImageElement;
          b.append(im, el('span', {}, `@Image${i + 1} ${r.label}`));
          b.addEventListener('click', () => {
            if (on.has(r.src)) on.delete(r.src);
            else on.add(r.src);
            b.setAttribute('aria-pressed', String(on.has(r.src)));
            showPrice();
          });
          const lead = !!r.card && !views.has(r.card);
          if (r.card && !lead) views.get(r.card)!.push({ r, b, im });
          else if (r.card) views.set(r.card, []);
          // Same @Image number, another of the card's pictures: the prompt stays right. Once a
          // picture is picked, only it is sent for that card (as in the export): its extra views go off.
          const sw = lead
            ? referenceSwitch(r, ctx, (src) => {
                const old = r.src;
                const wasOn = on.has(old);
                on.delete(old);
                for (const v of views.get(r.card!)!) {
                  if (v.r.src === src) v.im.src = v.r.src = old;
                  on.delete(v.r.src);
                  on.delete(src);
                  v.b.setAttribute('aria-pressed', 'false');
                }
                if (wasOn) on.add(src);
                r.src = src;
                im.src = src;
              })
            : undefined;
          if (sw) {
            const w = el('span', { class: 'dr-gen-refwrap' });
            w.append(b, sw);
            strip.append(w);
          } else strip.append(b);
        });
        box.append(strip, el('small', { class: 'dr-gen-refs-note' }, 'Sent in this order; the prompt calls them @Image1, @Image2… Switching one off renumbers the rest, so edit the prompt to match.'));
        refsOn = () => refs.filter((r) => on.has(r.src)).length;
        showPrice();
      }
      // The key, saved as soon as it's entered.
      const keyIn = el('input', { type: 'text', class: 'dr-key-masked', autocomplete: 'off', spellcheck: 'false', 'aria-label': gen.key?.label ?? 'API key', placeholder: `Paste your ${gen.key?.label ?? 'API key'}` }) as HTMLInputElement;
      keyIn.addEventListener('input', () => {
        const k = keyIn.value.replace(/^\s*(?:bearer\s+|key\s+)?/i, '').replace(/[\s"'`]/g, '');
        if (gen.key && k) gen.key.set(k);
      });
      if (gen.key && !gen.key.get()) box.append(keyIn, ...(gen.key.help ? [el('small', {}, gen.key.help)] : []));
      const go = el('button', { type: 'button', class: 'dr-gen-go' }, `🎬 Generate with ${gen.name}`) as HTMLButtonElement;
      const cancel = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Cancel') as HTMLButtonElement;
      const st = el('div', { class: 'dr-gen-status', role: 'status' });
      cancel.addEventListener('click', () => {
        // Already sent? It still finishes on the service: the field keeps the job and collects it.
        if (jobOf()) status.textContent = 'Still generating: it will be collected when it’s ready.';
        openGen();
        // After the cancelled wait has let go of it.
        setTimeout(() => jobOf() && void collectJob(), 50);
      });
      go.addEventListener('click', async () => {
        if (gen.key && !gen.key.get()) return void (st.textContent = `Add your ${gen.key.label} first.`);
        if (!prompt.value.trim()) return void (st.textContent = 'Write a prompt first.');
        abort = new AbortController();
        go.disabled = true;
        st.textContent = `Asking ${gen.name}…`;
        let submitted = false;
        let jobKey = '';
        making = { text: `Asking ${gen.name}…`, since: Date.now() };
        draw();
        try {
          // Pictures the service can read: drawings (SVG) and oversized pictures become JPEGs, as in ✨.
          st.textContent = 'Preparing pictures…';
          const ready = (src: string) =>
            referencePicture(src).catch((err) => {
              throw new Error(`A reference picture couldn’t be prepared (${(err as Error).message}). Switch it off and try again.`);
            });
          const picked = await Promise.all(refs.filter((r) => on.has(r.src)).map((r) => ready(r.src)));
          const first = s?.firstFrame && on.has(s.firstFrame) ? await ready(s.firstFrame) : undefined;
          st.textContent = `Asking ${gen.name}…`;
          const result = await gen.generate({
            prompt: prompt.value.trim(),
            references: picked,
            firstFrame: first,
            duration: Number(dur.value),
            aspect: aspect.value,
            resolution: res.value,
            model: model.value,
            audio: audio.checked && !audio.disabled,
            signal: abort.signal,
            onProgress: (t, pc) => {
              st.textContent = pc != null ? `${t} ${Math.round(pc)}%` : t;
              progress(t, pc);
            },
            // Accepted: keep the job on the shot, so the clip can be collected even if this page can't wait.
            onSubmitted: (job) => {
              submitted = true;
              collecting.add(`${ctx.node.id}:${job.startedAt}`);
              ctx.graph.setParam(ctx.node.id, 'clipJob', job);
              jobKey = `${ctx.node.id}:${job.startedAt}`;
            },
          });
          const clip = result.videos[0];
          if (!clip) throw new Error(`${gen.name} returned no clip`);
          const e = quote();
          st.textContent = 'Taking the last frame…';
          await collect(clip, result.cost ?? (e ? `about ${money(e)}` : ''), abort.signal);
          panel = undefined;
          draw();
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          if (submitted && (err as { code?: string }).code === 'pending') {
            // Still on the service: the field shows it and collects it later.
            status.textContent = (err as Error).message;
            panel = undefined;
            return draw();
          }
          if (submitted) ctx.graph.setParam(ctx.node.id, 'clipJob', null);
          st.textContent = (err as Error).message || 'Something went wrong';
          go.disabled = false;
        } finally {
          if (jobKey) collecting.delete(jobKey);
          making = undefined;
          if (wrap.isConnected) draw();
        }
      });
      box.append(row(go, cancel, ...(gen.site ? [el('a', { href: gen.site, target: '_blank', rel: 'noopener', class: 'dr-gen-cancel dr-gen-link' }, 'Prices')] : [])), st);
      panel = box;
      draw();
      // Not on touch screens: focusing would pop up the keyboard over the panel.
      if (globalThis.matchMedia?.('(pointer: fine)').matches) prompt.focus({ preventScroll: true });
    };
    // Changes from elsewhere (undo, another device's save) redraw it.
    (wrap as HTMLElement & { setClip?: (v: unknown) => void }).setClip = (v) => {
      const next = typeof v === 'string' ? v : '';
      if (next !== value) ((value = next), draw());
    };
    draw();
    return wrap;
  },
  update(el, v) {
    (el as HTMLElement & { setClip?: (v: unknown) => void }).setClip?.(v);
  },
};

export const imagesParam: ParamKind = {
  kind: 'images',
  render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'dr-images';
    let list = imageList(ctx.value);
    const max = Number((ctx.param as { max?: number }).max ?? 24);
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    // The input itself takes the tap (inside the "+" label) rather than being clicked from
    // code: iOS Safari, in-app browsers and sandboxed frames only reliably open the picker
    // for a direct tap. It is invisible, not display:none, so it stays tappable.
    file.className = 'dr-file';
    file.setAttribute('aria-label', 'Add images');
    const commit = (next: string[]) => {
      list = next;
      draw();
      ctx.set(next);
    };
    file.addEventListener('change', async () => {
      const files = [...(file.files ?? [])].slice(0, Math.max(0, max - list.length));
      file.value = '';
      const added: string[] = [];
      for (const f of files) {
        try {
          added.push(await imageFileToDataUrl(f));
        } catch {
          /* not an image the browser can decode */
        }
      }
      if (added.length) commit([...list, ...added]);
    });
    // ✨ Generate (when an image generator is set): a small panel with a prompt written
    // from the card, sent to the generator; results are copied in like added photos.
    let chosenGen: ImageGenerator | null = preferred('image', getImageGenerators());
    const p = ctx.param as {
      prompt?: (node: NodeInstance, graph: Graph) => { prompt: string; aspect?: string; references?: { src: string; label: string }[] } | undefined;
      browse?: boolean;
    };
    /** Copy a picture in from a service (its links expire); keep the link if it can't be fetched. */
    const keep = async (url: string, signal?: AbortSignal): Promise<{ src: string; copied: boolean }> => {
      if (url.startsWith('data:')) return { src: url, copied: true }; // already the picture itself
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(String(res.status));
        return { src: await imageFileToDataUrl(await res.blob()), copied: true };
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        return { src: url, copied: false };
      }
    };
    let panel: HTMLElement | undefined;
    let note = '';
    /** A picture being made: a placeholder thumbnail in the strip, where it will land. */
    let making: Pending | undefined;
    const closePanel = () => {
      panel?.remove();
      panel = undefined;
    };
    const openPanel = () => {
      const gen = chosenGen;
      if (!gen) return;
      if (panel) return closePanel();
      const suggestion = (() => {
        try {
          return p.prompt?.(ctx.node, ctx.graph);
        } catch {
          return undefined;
        }
      })();
      const el = (tag: string, attrs: Record<string, string> = {}, text = '') => {
        const x = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
        if (text) x.textContent = text;
        return x;
      };
      panel = el('div', { class: 'dr-gen-panel', role: 'group', 'aria-label': `Generate an image with ${gen.name}` });
      // More than one service: pick one (remembered); the panel reopens for it.
      const gens = getImageGenerators();
      if (gens.length > 1) {
        const service = el('select', { 'aria-label': 'Service', class: 'dr-gen-service' }) as HTMLSelectElement;
        for (const g of gens) service.append(Object.assign(document.createElement('option'), { value: g.id, textContent: g.name }));
        service.value = gen.id;
        service.addEventListener('change', () => {
          chosenGen = gens.find((g) => g.id === service.value) ?? gen;
          remember('image', chosenGen.id);
          closePanel();
          openPanel();
          draw();
        });
        const row = el('div', { class: 'dr-gen-row' });
        row.append(el('small', {}, 'Service'), service);
        panel.append(row);
      }
      const prompt = el('textarea', { rows: '4', 'aria-label': 'Image prompt', placeholder: 'Describe the picture' }) as HTMLTextAreaElement;
      prompt.value = suggestion?.prompt ?? '';
      const row = el('div', { class: 'dr-gen-row' });
      const model = el('select', { 'aria-label': 'Model' }) as HTMLSelectElement;
      for (const m of gen.models ?? []) model.append(Object.assign(document.createElement('option'), { value: m.id, textContent: m.label }));
      model.value = gen.defaultModel ?? model.value;
      const aspect = el('select', { 'aria-label': 'Aspect ratio' }) as HTMLSelectElement;
      for (const a of ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']) aspect.append(Object.assign(document.createElement('option'), { value: a, textContent: a }));
      aspect.value = suggestion?.aspect ?? '1:1';
      if (gen.models?.length) row.append(model);
      row.append(aspect);
      // Reference pictures (for generators that take them): the cards' pictures of who and what
      // is in it, then this card's own, as toggles. The suggested ones start on, up to the limit.
      const maxRefs = gen.maxReferences ?? 0;
      const refChoices = maxRefs
        ? [...(suggestion?.references ?? []), ...list.map((src, i) => ({ src, label: `This card’s picture ${i + 1}`, own: true }))].filter(
            (r, i, all) => all.findIndex((x) => x.src === r.src) === i,
          )
        : [];
      const chosen = new Set(refChoices.filter((r) => !('own' in r)).slice(0, maxRefs).map((r) => r.src));
      const refs = el('div', { class: 'dr-gen-refs', role: 'group', 'aria-label': 'Reference pictures' });
      const refNote = el('small', { class: 'dr-gen-refs-note' });
      const noteRefs = () =>
        (refNote.textContent = chosen.size
          ? `${chosen.size} reference picture${chosen.size > 1 ? 's' : ''} sent with the prompt (up to ${maxRefs}). Tap to switch one off or on.`
          : `No reference pictures: text only. Tap one to send it (up to ${maxRefs}).`);
      for (const r of refChoices as Reference[]) {
        const b = el('button', { type: 'button', class: 'dr-gen-ref', title: r.label, 'aria-label': r.label, 'aria-pressed': String(chosen.has(r.src)) }) as HTMLButtonElement;
        const im = el('img', { src: r.src, alt: '' }) as HTMLImageElement;
        b.append(im, el('span', {}, r.label));
        const sw = referenceSwitch(r, ctx, (src) => {
          if (chosen.delete(r.src)) chosen.add(src);
          r.src = src;
          im.src = src;
        });
        b.addEventListener('click', () => {
          if (chosen.has(r.src)) chosen.delete(r.src);
          else if (chosen.size >= maxRefs) return void (status.textContent = `${gen.name} takes up to ${maxRefs} reference pictures: switch one off first.`);
          else chosen.add(r.src);
          b.setAttribute('aria-pressed', String(chosen.has(r.src)));
          noteRefs();
        });
        if (sw) {
          const w = el('span', { class: 'dr-gen-refwrap' });
          w.append(b, sw);
          refs.append(w);
        } else refs.append(b);
      }
      noteRefs();
      // What it will cost, and what's left: re-checked when the model or the references change.
      const cost = el('small', { class: 'dr-gen-cost', role: 'status' });
      let costAsk = 0;
      const showCost = async () => {
        if (!gen.estimate && !gen.balance) return;
        const ask = ++costAsk;
        const m = gen.models?.length ? model.value : undefined;
        try {
          const [est, bal] = await Promise.all([gen.estimate?.({ model: m, references: chosen.size }), gen.key && !gen.key.get() ? undefined : gen.balance?.()]);
          if (ask !== costAsk) return;
          const label = gen.models?.find((x) => x.id === m)?.label ?? m ?? gen.name;
          cost.textContent = [
            est
              ? est.unit === 'USD'
                ? `About $${est.credits.toFixed(2)} (${est.basis})`
                : `About ${est.credits} credit${est.credits === 1 ? '' : 's'} (${est.basis})`
              : `Cost with ${label} not known yet: it shows after the first one`,
            bal != null ? `${bal.toLocaleString()} left` : '',
          ]
            .filter(Boolean)
            .join(' · ');
        } catch {
          if (ask === costAsk) cost.textContent = '';
        }
      };
      model.addEventListener('change', () => void showCost());
      refs.addEventListener('click', () => void showCost());
      // The key: a plain text field, masked (not type=password, so phone keyboards offer their
      // clipboard and paste behaves), with Paste and Show buttons. Saved as soon as it's entered.
      const keyRow = el('div', { class: 'dr-gen-key' });
      const keyInput = el('input', {
        type: 'text',
        class: 'dr-key-masked',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        inputmode: 'text',
        'aria-label': gen.key?.label ?? 'API key',
        placeholder: `Paste your ${gen.key?.label ?? 'API key'}`,
      }) as HTMLInputElement;
      const status = el('div', { class: 'dr-gen-status', role: 'status' });
      /** Keys arrive with spaces, line breaks, quotes or "Bearer " stuck to them: drop those. */
      const cleanKey = (v: string) => v.replace(/^\s*(?:bearer\s+)?/i, '').replace(/[\s"'`]/g, '');
      const saveKey = () => {
        const k = cleanKey(keyInput.value);
        if (keyInput.value !== k) keyInput.value = k;
        if (!gen.key || !k) return;
        gen.key.set(k);
        status.textContent = `${gen.key.label} saved in this browser.`;
      };
      keyInput.addEventListener('input', saveKey);
      keyInput.addEventListener('change', () => void showCost());
      keyInput.addEventListener('paste', () => setTimeout(saveKey, 0));
      const paste = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Paste') as HTMLButtonElement;
      paste.addEventListener('click', async () => {
        try {
          keyInput.value = await navigator.clipboard.readText();
          saveKey();
        } catch {
          keyInput.focus();
          status.textContent = 'This page can’t read the clipboard: long-press the field and choose Paste.';
        }
      });
      const show = el('button', { type: 'button', class: 'dr-gen-cancel', 'aria-pressed': 'false' }, 'Show') as HTMLButtonElement;
      show.addEventListener('click', () => {
        const on = keyInput.classList.toggle('dr-key-masked');
        show.textContent = on ? 'Show' : 'Hide';
        show.setAttribute('aria-pressed', String(!on));
      });
      const keyTools = el('div', { class: 'dr-gen-row' });
      keyTools.append(keyInput, paste, show);
      const changeKey = el('button', { type: 'button', class: 'dr-gen-link-btn' }, `Change ${gen.key?.label ?? 'API key'}`);
      if (gen.key && !gen.key.get()) keyRow.append(keyTools, ...(gen.key.help ? [el('small', {}, gen.key.help)] : []));
      else if (gen.key) {
        keyRow.append(changeKey);
        changeKey.addEventListener('click', () => {
          keyRow.replaceChildren(keyTools, ...(gen.key!.help ? [el('small', {}, gen.key!.help)] : []));
          keyInput.focus();
        });
      }
      const go = el('button', { type: 'button', class: 'dr-gen-go' }, `✨ Generate with ${gen.name}`) as HTMLButtonElement;
      const cancel = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Cancel') as HTMLButtonElement;
      let abort: AbortController | undefined;
      cancel.addEventListener('click', () => {
        abort?.abort();
        making = undefined;
        closePanel();
        draw();
      });
      go.addEventListener('click', async () => {
        if (gen.key && keyInput.value.trim()) gen.key.set(cleanKey(keyInput.value));
        if (gen.key && !gen.key.get()) return void (status.textContent = `Add your ${gen.key.label} first.`);
        if (!prompt.value.trim()) return void (status.textContent = 'Write a prompt first.');
        abort = new AbortController();
        go.disabled = true;
        status.textContent = `Asking ${gen.name}…`;
        making = { text: `Asking ${gen.name}…`, since: Date.now() };
        draw();
        try {
          // Chosen references in their order, made readable for the service; the prompt says
          // which is which, so the model knows whose face and which room it is looking at.
          const picked = refChoices.filter((r) => chosen.has(r.src));
          const references = picked.length ? await Promise.all(picked.map((r) => referencePicture(r.src))) : undefined;
          const legend = picked.length ? ` Reference pictures, in order: ${picked.map((r, i) => `${i + 1}. ${r.label}`).join('; ')}. Keep the people, costumes, places and objects looking as they do in them.` : '';
          const result = await gen.generate({
            references,
            prompt: prompt.value.trim() + legend,
            aspect: aspect.value,
            model: gen.models?.length ? model.value : undefined,
            signal: abort.signal,
            onProgress: (pc) => {
              status.textContent = `Generating with ${gen.name}… ${Math.round(pc)}%`;
              making = { ...making!, text: `Generating with ${gen.name}`, percent: pc };
              draw();
            },
          });
          status.textContent = 'Copying the picture in…';
          // The service's links expire: keep a copy, shrunk like added photos.
          let kept = 0;
          const added: string[] = [];
          for (const url of result.images.slice(0, Math.max(0, max - list.length))) {
            const k = await keep(url, abort.signal);
            added.push(k.src);
            if (k.copied) kept++;
          }
          if (!added.length) throw new Error(`${gen.name} returned no picture`);
          note = `Added ${added.length} from ${gen.name}${result.credits != null ? ` · ${result.credits} credits` : ''}${result.balance != null ? ` · ${result.balance.toLocaleString()} left` : ''}${kept < added.length ? ' · linked, not copied: the link expires' : ''}`;
          making = undefined;
          closePanel();
          commit([...list, ...added]);
        } catch (err) {
          making = undefined;
          draw();
          if ((err as Error).name === 'AbortError') return;
          status.textContent = (err as Error).message || 'Something went wrong';
          go.disabled = false;
        }
      });
      const buttons = el('div', { class: 'dr-gen-row' });
      buttons.append(go, cancel);
      // The prompt is useful on its own too: copy it (and open the service's site) to make the
      // picture by hand, then add it with +. Handy where this page can't reach the service.
      const copy = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Copy prompt') as HTMLButtonElement;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(prompt.value);
          status.textContent = 'Prompt copied.';
        } catch {
          prompt.select();
          status.textContent = 'Prompt selected: copy it from the menu.';
        }
      });
      buttons.append(copy);
      if (gen.site) {
        const open = el('a', { href: gen.site, target: '_blank', rel: 'noopener', class: 'dr-gen-cancel dr-gen-link' }, `Open ${gen.name}`);
        buttons.append(open);
      }
      panel.append(prompt, row, ...(refChoices.length ? [refs, refNote] : []), cost, keyRow, buttons, status);
      void showCost();
      wrap.append(panel);
      // Not on touch screens: focusing would pop up the keyboard over the panel.
      if (globalThis.matchMedia?.('(pointer: fine)').matches) prompt.focus({ preventScroll: true });
    };
    const draw = () => {
      const gen = chosenGen;
      wrap.replaceChildren();
      list.forEach((src, i) => {
        const t = document.createElement('span');
        t.className = 'dr-thumb';
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'dr-view';
        view.dataset.nmView = ''; // still opens in view-only editors
        view.setAttribute('aria-label', `View image ${i + 1}`);
        view.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
        view.addEventListener('click', () => openLightbox(list, i, ctx.node.label));
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'dr-rm';
        rm.textContent = '×';
        rm.setAttribute('aria-label', `Remove image ${i + 1}`);
        rm.addEventListener('click', () => commit(list.filter((_, j) => j !== i)));
        t.append(view, rm);
        // Order matters (the first frame or picture leads the video prompt): ‹ › move one along.
        if (list.length > 1 && (ctx.param as { sortable?: boolean }).sortable !== false) {
          const move = (d: number, glyph: string, label: string) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `dr-mv ${d < 0 ? 'dr-mv-l' : 'dr-mv-r'}`;
            b.textContent = glyph;
            b.setAttribute('aria-label', `Move image ${i + 1} ${label}`);
            b.disabled = i + d < 0 || i + d >= list.length;
            b.addEventListener('click', () => {
              const next = [...list];
              [next[i], next[i + d]] = [next[i + d], next[i]];
              commit(next);
            });
            return b;
          };
          t.append(move(-1, '‹', 'earlier'), move(1, '›', 'later'));
        }
        wrap.append(t);
      });
      if (making) wrap.append(pendingTile('dr-thumb', making));
      if (list.length < max) {
        const add = document.createElement('label');
        add.className = 'dr-add';
        add.append(list.length ? '+' : '+ Add images', file);
        wrap.append(add);
        if (gen) {
          const g = document.createElement('button');
          g.type = 'button';
          g.className = 'dr-gen';
          g.textContent = '✨';
          g.title = `Generate with ${gen.name}`;
          g.setAttribute('aria-label', `Generate an image with ${gen.name}`);
          g.addEventListener('click', openPanel);
          wrap.append(g);
        }
      }
      // 🔍 (fields that allow it): search the person's existing pictures on the service.
      if (gen?.browse && p.browse && ctx.choose && list.length < max) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'dr-gen dr-browse';
        s.textContent = '🔍';
        s.title = `Search your ${gen.name} assets`;
        s.setAttribute('aria-label', `Search your ${gen.name} assets`);
        s.addEventListener('click', async () => {
          if (gen.key && !gen.key.get()) {
            openPanel();
            const st = wrap.querySelector('.dr-gen-status');
            if (st) st.textContent = `Add your ${gen.key.label} here, then tap 🔍 again.`;
            return;
          }
          s.disabled = true;
          s.textContent = '…';
          try {
            const assets = await gen.browse!();
            if (!assets.length) {
              note = `No pictures or 3D models on ${gen.name} yet`;
              return;
            }
            const id = await ctx.choose!({
              title: `Your ${gen.name} assets`,
              placeholder: `Search ${assets.length} by prompt or name`,
              items: assets.map((a) => ({ id: a.id, label: a.label, hint: a.hint, image: a.thumb })),
            });
            const asset = assets.find((a) => a.id === id);
            if (!asset) return;
            const k = await keep(asset.url);
            note = `Added from ${gen.name}${k.copied ? '' : ' · linked, not copied: the link expires'}`;
            commit([...list, k.src]);
          } catch (err) {
            note = (err as Error).message || `Couldn't reach ${gen.name}`;
          } finally {
            s.disabled = false;
            s.textContent = '🔍';
            draw();
          }
        });
        wrap.append(s);
      }
      if (note) wrap.append(Object.assign(document.createElement('small'), { className: 'dr-gen-note', textContent: note }));
      if (panel) wrap.append(panel);
    };
    // Inside a <label>, a tap on a thumbnail's gap would "click" the first button: don't.
    wrap.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('button, input, label')) e.preventDefault();
    });
    (wrap as HTMLElement & { _set?: (v: unknown) => void })._set = (v) => {
      list = imageList(v);
      draw();
    };
    draw();
    return wrap;
  },
  update(el, value) {
    (el as HTMLElement & { _set?: (v: unknown) => void })._set?.(value);
  },
};

// ------------------------------------------------------------------ nodes

const T = {
  location: 'drama/location',
  character: 'drama/character',
  prop: 'drama/prop',
  costume: 'drama/costume',
  shot: 'drama/shot',
  scene: 'drama/scene',
  episode: 'drama/episode',
  season: 'drama/season',
} as const;

/** A shot's finished clip and whether it carries on from the shot before (wired and board shots). */
export const SHOT_CLIP_PARAMS = [
  {
    name: 'continues',
    label: 'continues previous shot',
    kind: 'boolean' as const,
    default: false,
    description: 'One camera take carried on from the shot before it in the scene: its clip starts on that clip’s last frame, without a cut.',
  },
  {
    name: 'lastFrame',
    label: 'clip',
    kind: 'clipframe',
    default: '',
    description: 'Add the finished clip: its last frame starts the next shot if that one continues this, and keeps the next shot consistent if not.',
    // 🎬 Generate clip starts from the shot's Seedance prompt and pictures.
    video: (node: NodeInstance, graph: Graph) => shotClipSuggestion(graph, node.id),
  },
];

const description = (advanced = false, placeholder = '') => ({ name: 'description', label: 'description', kind: 'text' as const, multiline: true, default: '', placeholder, advanced });
const images = (name = 'images', label = 'images', advanced = false) => ({
  name,
  label,
  kind: 'images',
  default: [],
  advanced,
  // What ✨ Generate suggests for this field (see dramaImagePrompt).
  prompt: (node: NodeInstance, graph: Graph) => dramaImagePrompt(graph, node, name),
});
/** Look and feel for video prompts (Seedance export); an episode's beats its season's. */
const look = () => [
  { name: 'style', label: 'video style', kind: 'text' as const, multiline: true, default: '', placeholder: 'e.g. 16mm film, warm stage lighting, coming-of-age drama', advanced: true },
  { name: 'aspect', label: 'aspect ratio', kind: 'select' as const, options: ['inherit', '16:9', '9:16', '1:1', '4:3', '21:9'], default: 'inherit', advanced: true },
  {
    name: 'maxImages',
    label: 'reference images',
    kind: 'number' as const,
    default: 0,
    min: 0,
    max: 50,
    step: 1,
    advanced: true,
    description: 'Most images per video clip. 0 = inherit (season, then 9, Seedance 2.0’s limit). Raise it for models that take more.',
  },
  {
    name: 'maxClip',
    label: 'clip seconds',
    kind: 'number' as const,
    default: 0,
    min: 0,
    max: 60,
    step: 1,
    advanced: true,
    description: 'Longest video clip. 0 = inherit (season, then 15 s).',
  },
];
const number = (def = 1) => ({ name: 'number', label: 'number', kind: 'number' as const, default: def, min: 1, step: 1 });

const locationNode = defineNode({
  type: T.location,
  title: 'Location',
  category: 'Cast & places',
  color: '#2f9e44',
  icon: '⌂',
  flavor: 'source',
  width: 230,
  tags: ['set', 'place', 'stage'],
  description: 'Where shots happen: a name, a description and pictures',
  outputs: { shots: { type: DRAMA.location, label: 'shots' } },
  params: [
    { name: 'setting', label: 'setting', kind: 'select', options: ['INT', 'EXT'], default: 'INT' },
    description(false, 'What it looks like'),
    images(),
  ],
  onCreate: (n) => void (n.label ??= 'New location'),
  meta: { drama: 'location' },
});

const characterNode = defineNode({
  type: T.character,
  title: 'Character',
  category: 'Cast & places',
  color: '#e8590c',
  icon: '☺',
  flavor: 'source',
  width: 230,
  tags: ['actor', 'role', 'cast', 'person'],
  description: 'Someone in the story: a name, a description and pictures',
  outputs: { appears: { type: DRAMA.character, label: 'in shots' } },
  params: [
    description(false, 'Who they are'),
    {
      name: 'appearance',
      label: 'appearance',
      kind: 'text',
      multiline: true,
      default: '',
      placeholder: 'Age, build, hair, face, usual clothes',
      description: 'Repeated word for word in every video prompt they are in, to keep them looking the same',
    },
    images(),
    { name: 'actor', label: 'played by', kind: 'text', default: '', placeholder: 'Cast member', advanced: true },
  ],
  onCreate: (n) => void (n.label ??= 'New character'),
  meta: { drama: 'character' },
});

const propNode = defineNode({
  type: T.prop,
  title: 'Prop',
  category: 'Cast & places',
  color: '#ae3ec9',
  icon: '✦',
  flavor: 'source',
  width: 210,
  tags: ['object', 'item', 'thing'],
  description: 'An object the shots need',
  outputs: { used: { type: DRAMA.prop, label: 'in shots' } },
  params: [description(false, 'What it is'), { ...images('images', 'images', true), browse: true }],
  onCreate: (n) => void (n.label ??= 'New prop'),
  meta: { drama: 'prop' },
});

const costumeNode = defineNode({
  type: T.costume,
  title: 'Costume',
  category: 'Cast & places',
  color: '#d6336c',
  icon: '👕',
  flavor: 'transform',
  width: 230,
  tags: ['wardrobe', 'outfit', 'clothes', 'look'],
  description: 'What a character wears in the scenes (or single shots) it is wired into',
  inputs: { character: { type: DRAMA.character, label: 'character', description: 'Who wears it' } },
  outputs: { scenes: { type: DRAMA.costume, label: 'in scenes / shots' } },
  params: [description(false, 'What they wear: garments, colours, accessories'), { ...images(), browse: true }],
  onCreate: (n) => void (n.label ??= 'New costume'),
  meta: { drama: 'costume' },
});

const shotNode = defineNode({
  type: T.shot,
  title: 'Shot',
  category: 'Story',
  color: '#1971c2',
  icon: '▣',
  flavor: 'transform',
  width: 250,
  tags: ['camera', 'frame', 'take', 'angle'],
  description: 'One camera set-up: one location, any number of characters',
  inputs: {
    location: { type: DRAMA.location, label: 'location', description: 'A shot has one location' },
    characters: { type: DRAMA.character, multiple: true, label: 'characters' },
    props: { type: DRAMA.prop, multiple: true, label: 'props' },
    costumes: { type: DRAMA.costume, multiple: true, label: 'costumes', description: 'What characters wear in this shot, over what the scene says' },
  },
  outputs: { scene: { type: DRAMA.shot, label: 'scene' } },
  caption: (n) => `Shot ${String(n.params.number ?? '').trim() || '?'} · ${n.params.framing ?? 'Medium'}`,
  params: [
    { name: 'number', label: 'shot', kind: 'text', default: '1', placeholder: '1, 2, 2A…' },
    { name: 'framing', label: 'framing', kind: 'select', options: FRAMINGS, default: 'Medium' },
    description(false, 'What we see and hear'),
    images('images', 'frames'),
    ...SHOT_CLIP_PARAMS,
    { name: 'movement', label: 'camera', kind: 'select', options: MOVES, default: 'Static', advanced: true },
    { name: 'duration', label: 'seconds', kind: 'number', default: 5, min: 0, step: 1, advanced: true },
  ],
  meta: { drama: 'shot' },
});

const sceneNode = defineNode({
  type: T.scene,
  title: 'Scene',
  category: 'Story',
  color: '#5f3dc4',
  icon: '❏',
  flavor: 'transform',
  width: 250,
  tags: ['sequence', 'act'],
  description: 'A numbered scene made of shots, with an optional storyboard',
  inputs: {
    shots: { type: DRAMA.shot, multiple: true, label: 'shots' },
    costumes: { type: DRAMA.costume, multiple: true, label: 'costumes', description: 'What characters wear in this scene' },
  },
  outputs: { episode: { type: DRAMA.scene, label: 'episode' } },
  caption: (n) => `Scene ${Number(n.params.number ?? 1)} · ${n.params.time ?? 'DAY'}`,
  params: [
    number(),
    { name: 'time', label: 'time', kind: 'select', options: TIMES, default: 'DAY' },
    description(false, 'What happens'),
    images('storyboard', 'storyboard', true),
  ],
  meta: { drama: 'scene' },
});

const episodeNode = defineNode({
  type: T.episode,
  title: 'Episode',
  category: 'Story',
  color: '#c2255c',
  icon: '▶',
  flavor: 'sink',
  width: 250,
  tags: ['chapter', 'show', 'play', 'act'],
  description: 'A titled, numbered episode made of scenes',
  inputs: { scenes: { type: DRAMA.scene, multiple: true, label: 'scenes' } },
  outputs: { season: { type: DRAMA.episode, label: 'season' } },
  params: [number(), description(false, 'Optional synopsis'), images('images', 'poster', true), ...look()],
  onCreate: (n) => void (n.label ??= 'Untitled episode'),
  meta: { drama: 'episode' },
});

const seasonNode = defineNode({
  type: T.season,
  title: 'Season',
  category: 'Story',
  color: '#495057',
  icon: '▤',
  flavor: 'sink',
  width: 230,
  tags: ['series', 'show', 'production', 'term'],
  description: 'A run of episodes',
  inputs: { episodes: { type: DRAMA.episode, multiple: true, label: 'episodes' } },
  params: [number(), description(true, 'What the season is about'), ...look()],
  onCreate: (n) => void (n.label ??= 'Season'),
  meta: { drama: 'season' },
});

// ------------------------------------------------------------------ breakdown

const DEFAULT_NAME: Record<string, string> = {
  [T.location]: 'Location',
  [T.character]: 'Character',
  [T.prop]: 'Prop',
  [T.episode]: 'Episode',
  [T.season]: 'Season',
};
export const dramaName = (n: NodeInstance) => (n.label ?? '').trim() || DEFAULT_NAME[n.type] || n.type;

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
/** m:ss */
export const runtime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const from = (graph: Graph, id: string, port: string) =>
  graph
    .incoming(id)
    .filter((e) => e.to.port === port)
    .map((e) => graph.nodes.get(e.from.node))
    .filter((n): n is NodeInstance => !!n);
const into = (graph: Graph, id: string) =>
  graph
    .outgoing(id)
    .map((e) => graph.nodes.get(e.to.node))
    .filter((n): n is NodeInstance => !!n);

export interface ShotInfo {
  node: NodeInstance;
  number: string;
  framing: string;
  movement: string;
  duration: number;
  description: string;
  location?: NodeInstance;
  characters: NodeInstance[];
  props: NodeInstance[];
  images: string[];
}
export interface SceneInfo {
  node: NodeInstance;
  number: number;
  time: string;
  description: string;
  shots: ShotInfo[];
  characters: NodeInstance[];
  locations: NodeInstance[];
  duration: number;
  /** "INT. SCHOOL HALL — DAY" */
  slug: string;
  storyboard: string[];
  /** Costumes wired into the scene, with who wears each. */
  costumes: { costume: NodeInstance; character?: NodeInstance }[];
}
export interface EpisodeInfo {
  node: NodeInstance;
  number: number;
  title: string;
  description: string;
  scenes: SceneInfo[];
  characters: NodeInstance[];
  locations: NodeInstance[];
  duration: number;
  shots: number;
}

export function shotInfo(graph: Graph, n: NodeInstance): ShotInfo {
  return {
    node: n,
    number: String(n.params.number ?? '').trim() || '?',
    framing: String(n.params.framing ?? 'Medium'),
    movement: String(n.params.movement ?? 'Static'),
    duration: Math.max(0, Number(n.params.duration ?? 5) || 0),
    description: String(n.params.description ?? '').trim(),
    location: from(graph, n.id, 'location')[0],
    characters: from(graph, n.id, 'characters'),
    props: from(graph, n.id, 'props'),
    images: imageList(n.params.images),
  };
}

export function sceneInfo(graph: Graph, n: NodeInstance): SceneInfo {
  const shots = from(graph, n.id, 'shots')
    .map((s) => shotInfo(graph, s))
    .sort((a, b) => natural(a.number, b.number));
  const locations = uniq(shots.map((s) => s.location).filter((l): l is NodeInstance => !!l));
  const settings = uniq(locations.map((l) => String(l.params.setting ?? 'INT')));
  const time = String(n.params.time ?? 'DAY');
  const place = locations.length ? locations.map((l) => dramaName(l).toUpperCase()).join(' / ') : 'SOMEWHERE';
  return {
    node: n,
    number: Number(n.params.number ?? 1),
    time,
    description: String(n.params.description ?? '').trim(),
    shots,
    characters: uniq(shots.flatMap((s) => s.characters)),
    locations,
    duration: shots.reduce((t, s) => t + s.duration, 0),
    slug: `${settings.length === 1 ? settings[0] : settings.length ? 'INT./EXT' : 'INT'}. ${place} — ${time}`,
    storyboard: imageList(n.params.storyboard),
    costumes: from(graph, n.id, 'costumes').map((costume) => ({ costume, character: from(graph, costume.id, 'character')[0] })),
  };
}

export function episodeInfo(graph: Graph, n: NodeInstance): EpisodeInfo {
  const scenes = from(graph, n.id, 'scenes')
    .map((s) => sceneInfo(graph, s))
    .sort((a, b) => a.number - b.number);
  return {
    node: n,
    number: Number(n.params.number ?? 1),
    title: dramaName(n),
    description: String(n.params.description ?? '').trim(),
    scenes,
    characters: uniq(scenes.flatMap((s) => s.characters)),
    locations: uniq(scenes.flatMap((s) => s.locations)),
    duration: scenes.reduce((t, s) => t + s.duration, 0),
    shots: scenes.reduce((t, s) => t + s.shots.length, 0),
  };
}

/** Where a character, location or prop turns up: scenes (with their episode) and shots. */
export function appearances(graph: Graph, id: string): { shot: ShotInfo; scene?: NodeInstance; episode?: NodeInstance }[] {
  return into(graph, id)
    .filter((n) => n.type === T.shot)
    .map((s) => {
      const scene = into(graph, s.id).find((x) => x.type === T.scene);
      const episode = scene && into(graph, scene.id).find((x) => x.type === T.episode);
      return { shot: shotInfo(graph, s), scene, episode };
    });
}

/**
 * A prompt for generating a picture for a drama node's image field: a reference portrait for
 * a character, an establishing shot for a location, a product shot for a prop, a costume on
 * a mannequin, a storyboard frame for a shot or scene, a poster for an episode. Works on the
 * wired drama model (drama boards convert first).
 */
export function dramaImagePrompt(graph: Graph, n: NodeInstance, param = 'images'): DramaImagePrompt | undefined {
  const base = basePrompt(graph, n, param);
  return base && { ...base, references: dramaImageReferences(graph, n) };
}

/** A suggested picture to generate from, and the reference pictures to send with it. */
export interface DramaImagePrompt {
  prompt: string;
  aspect: string;
  /** Pictures of what is in it (most important first): who is on screen, where, what they wear and hold. */
  references: Reference[];
}

/** A reference picture: from which card, and the other pictures that card has to choose from. */
export interface Reference {
  src: string;
  label: string;
  /** The card it comes from (character, location, prop…), when it's one of a card's pictures. */
  card?: string;
  /** All that card's pictures, when it has more than one (people can pick which to send). */
  choices?: string[];
}

/** A card's id without a costume copy's "@character" (Drama boards copy outfits per wearer). */
export const cardId = (id: string) => id.split('@')[0];

/**
 * Which of a card's pictures a target (the shot or card being generated for) sends as a
 * reference: the one picked for it (`referencePicks`, card id → picture), else the first.
 * `explicit`: a pick was made, so the card's other pictures stay out.
 */
export function referenceImages(card: NodeInstance, target?: NodeInstance): { picked: string | undefined; all: string[]; explicit: boolean } {
  const all = imageList(card.params.images);
  const picks = target?.params.referencePicks as Record<string, string> | undefined;
  const p = picks?.[cardId(card.id)];
  const explicit = !!p && all.includes(p);
  return { picked: explicit ? p : all[0], all, explicit };
}

/**
 * The pictures already on the cards a new picture should match, so a generator that takes
 * references draws the actual cast: for a shot, each character's portrait, the location, the
 * costumes they wear in that scene and the props; for a scene, its cast, locations and
 * costumes. Outfits and objects take none (they are drawn on their own). The first picture of
 * each card is used.
 */
export function dramaImageReferences(graph: Graph, n: NodeInstance): Reference[] {
  const out: Reference[] = [];
  const add = (node: NodeInstance | undefined, label: string) => {
    if (!node) return;
    const r = referenceImages(node, n);
    if (r.picked && !out.some((x) => x.src === r.picked)) out.push({ src: r.picked, label, card: cardId(node.id), ...(r.all.length > 1 ? { choices: r.all } : {}) });
  };
  const castAndPlaces = (characters: NodeInstance[], locations: NodeInstance[], costumes: Map<string, NodeInstance>, props: NodeInstance[] = []) => {
    // A character in costume: their portrait is for the face and hair, the costume for the clothes.
    characters.forEach((c) => add(c, costumes.has(c.id) ? `${dramaName(c)} (face and hair; not the clothes)` : dramaName(c)));
    locations.forEach((l) => add(l, `${dramaName(l)} (location)`));
    characters.forEach((c) => add(costumes.get(c.id), `${dramaName(c)}’s costume in this scene (what they wear)`));
    props.forEach((p) => add(p, `${dramaName(p)} (prop)`));
  };
  if (n.type === T.shot) {
    const s = shotInfo(graph, n);
    // How the shot before ended: where this one starts (continuing), or what it must match.
    const prev = previousShot(graph, n);
    const end = lastFrame(prev);
    const prevNo = prev ? String(prev.params.number ?? '').trim() || '?' : '';
    if (end && n.params.continues) out.push({ src: end, label: `End of shot ${prevNo} (this shot carries on from it)` });
    castAndPlaces(s.characters, s.location ? [s.location] : [], shotCostumes(graph, n.id), s.props);
    if (end && !n.params.continues && !out.some((r) => r.src === end)) out.push({ src: end, label: `End of shot ${prevNo} (for continuity)` });
  } else if (n.type === T.scene) {
    const info = sceneInfo(graph, n);
    castAndPlaces(info.characters, info.locations, sceneCostumes(graph, n.id));
  }
  // Outfits and objects are drawn on their own (a dress form, no hands), so they take no
  // reference people: a face would end up in the picture.
  return out;
}

function basePrompt(graph: Graph, n: NodeInstance, param: string): { prompt: string; aspect: string } | undefined {
  const t = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const end = (v: string) => (v && !/[.!?]$/.test(v) ? `${v}.` : v);
  const name = dramaName(n);
  const bare = (v: string) => v.replace(/[.!?]+$/, '');
  /**
   * A character as they look in this scene: their appearance word for word, and, when a costume
   * is wired into the scene for them, that costume in place of their usual clothes (as the
   * Seedance export says it).
   */
  const who = (c: NodeInstance, costumes?: Map<string, NodeInstance>) => {
    const k = costumes?.get(c.id);
    const look = [dramaName(c), bare(t(c.params.appearance))].filter(Boolean).join(': ');
    const what = bare(t(k?.params.description) || (k ? dramaName(k) : ''));
    return k ? `${look}. In this scene wearing ${what.charAt(0).toLowerCase()}${what.slice(1)}, instead of their usual clothes` : look;
  };
  const sceneOfShot = (id: string) => into(graph, id).find((x) => x.type === T.scene);
  const styleFor = (sceneNode?: NodeInstance) => {
    const ep = sceneNode && into(graph, sceneNode.id).find((x) => x.type === T.episode);
    const season = ep && into(graph, ep.id).find((x) => x.type === T.season);
    return t(ep?.params.style) || t(season?.params.style) || 'Cinematic live-action drama, natural light';
  };
  switch (n.type) {
    case T.character:
      return {
        prompt: `Character reference portrait of ${name}. ${end(t(n.params.appearance))} ${end(t(n.params.description))} Head to mid-thigh, facing the camera, neutral grey studio background, soft even light, photorealistic. No text.`.replace(/\s+/g, ' '),
        aspect: '3:4',
      };
    case T.location:
      return {
        prompt: `Establishing reference photo of ${name}, ${n.params.setting === 'EXT' ? 'exterior' : 'interior'}. ${end(t(n.params.description))} Wide shot, no people, natural light, photorealistic. No text.`.replace(/\s+/g, ' '),
        aspect: '16:9',
      };
    case T.prop:
      // The object on its own: no hands or people, so it can be put in anyone's hands later.
      return { prompt: `Product-style reference photo of ${name}, the object on its own. ${end(t(n.params.description))} Plain light background, soft light, photorealistic. No people, no hands, no text.`.replace(/\s+/g, ' '), aspect: '1:1' };
    case T.costume: {
      const wearer = from(graph, n.id, 'character')[0];
      return {
        // On a headless dress form, never a person: a face here would fight the actor's own
        // portrait when both are sent as references for a shot.
        prompt: `Costume reference: ${end(t(n.params.description) || name)}${wearer ? ` Made for ${dramaName(wearer)}.` : ''} The full outfit displayed on a headless dress form (mannequin), front view, plain neutral background, soft even light, photorealistic. No person, no face, no text.`.replace(/\s+/g, ' '),
        aspect: '3:4',
      };
    }
    case T.shot: {
      const s = shotInfo(graph, n);
      const sc = sceneOfShot(n.id);
      const time = sc ? String(sc.params.time ?? 'DAY').toLowerCase() : 'day';
      const where = s.location ? `Setting: ${dramaName(s.location)}, ${s.location.params.setting === 'EXT' ? 'exterior' : 'interior'}, ${time}. ${end(t(s.location.params.description))}` : '';
      const costumes = shotCostumes(graph, n.id);
      const cast = s.characters.length ? `On screen: ${s.characters.map((c) => who(c, costumes)).join('; ')}.` : '';
      return {
        prompt: `Storyboard frame, ${s.framing.toLowerCase()} shot.${n.params.continues ? ' It carries straight on from the previous shot, without a cut.' : ''} ${end(s.description)} ${cast} ${where} ${end(styleFor(sc))} Single film still, no text, no captions.`.replace(/\s+/g, ' ').trim(),
        aspect: '16:9',
      };
    }
    case T.scene: {
      const info = sceneInfo(graph, n);
      const costumes = sceneCostumes(graph, n.id);
      const cast = info.characters.length ? `Characters: ${info.characters.map((c) => who(c, costumes)).join('; ')}.` : '';
      return {
        prompt: `Storyboard frame for a scene set in ${info.slug}. ${end(info.description)} ${cast} ${end(styleFor(n))} Single film still, no text.`.replace(/\s+/g, ' ').trim(),
        aspect: '16:9',
      };
    }
    case T.episode:
      return {
        prompt: `Poster artwork for the episode "${name}". ${end(t(n.params.description))} ${end(t(n.params.style) || 'Cinematic drama')} No text or lettering.`.replace(/\s+/g, ' ').trim(),
        aspect: param === 'images' ? '2:3' : '16:9',
      };
    default:
      return undefined;
  }
}

/** The shot before this one in its scene (by shot number), or undefined for the first. */
export function previousShot(graph: Graph, shot: NodeInstance): NodeInstance | undefined {
  const scene = into(graph, shot.id).find((x) => x.type === T.scene);
  if (!scene) return undefined;
  const shots = sceneInfo(graph, scene).shots.map((s) => s.node);
  const i = shots.findIndex((s) => s.id === shot.id);
  return i > 0 ? shots[i - 1] : undefined;
}
const lastFrame = (n?: NodeInstance) => (n && typeof n.params.lastFrame === 'string' && n.params.lastFrame ? n.params.lastFrame : undefined);

/** The costume each character wears in a scene (the first wired in, if there are two). */
export function sceneCostumes(graph: Graph, sceneId: string): Map<string, NodeInstance> {
  const out = new Map<string, NodeInstance>();
  for (const c of from(graph, sceneId, 'costumes')) {
    const who = from(graph, c.id, 'character')[0];
    if (who && !out.has(who.id)) out.set(who.id, c);
  }
  return out;
}

/**
 * What each character wears in a shot: the scene's costumes, with the shot's own costumes over
 * them. A shot with `costumesExact` (Drama boards set it) wears exactly its own: a character
 * without one there is in their usual clothes, whatever the scene says.
 */
export function shotCostumes(graph: Graph, shotId: string): Map<string, NodeInstance> {
  const shot = graph.nodes.get(shotId);
  const scene = into(graph, shotId).find((x) => x.type === T.scene);
  const out = shot?.params.costumesExact || !scene ? new Map<string, NodeInstance>() : sceneCostumes(graph, scene.id);
  const own = new Map<string, NodeInstance>();
  for (const c of from(graph, shotId, 'costumes')) {
    const who = from(graph, c.id, 'character')[0];
    if (who && !own.has(who.id)) own.set(who.id, c);
  }
  for (const [who, c] of own) out.set(who, c);
  return out;
}

const names = (ns: NodeInstance[]) => ns.map(dramaName).join(', ');
const indent = (text: string, pad: string) => text.split('\n').map((l) => pad + l).join('\n');

function sceneText(s: SceneInfo): string {
  const out = [`SCENE ${s.number}. ${s.slug}  (${runtime(s.duration)})`];
  if (s.description) out.push(indent(s.description, '  '));
  for (const c of s.costumes) out.push(`  Costume, ${c.character ? dramaName(c.character) : '?'}: ${oneLineText(c.costume.params.description) || dramaName(c.costume)}`);
  for (const sh of s.shots) {
    const who = sh.characters.length ? names(sh.characters) : 'no one';
    out.push(`  ${sh.number.padEnd(4)} ${sh.framing.padEnd(18)} ${String(sh.duration).padStart(3)}s  ${who}${sh.props.length ? ` · props: ${names(sh.props)}` : ''}`);
    if (sh.description) out.push(indent(sh.description, '         '));
  }
  if (!s.shots.length) out.push('  (no shots yet)');
  return out.join('\n');
}

function episodeText(e: EpisodeInfo): string {
  const head = [`EPISODE ${e.number}: ${e.title}  (${runtime(e.duration)}, ${e.scenes.length} scenes, ${e.shots} shots)`];
  if (e.description) head.push(e.description);
  head.push(`Cast: ${names(e.characters) || '—'}`);
  head.push(`Locations: ${names(e.locations) || '—'}`);
  return [head.join('\n'), ...e.scenes.map(sceneText)].join('\n\n');
}

/**
 * A plain-text shot list: for a season, an episode or a scene (by id), or the whole map
 * (every season, then episodes and scenes that aren't in one yet).
 */
export function shotList(graph: Graph, id?: string): string {
  const node = id ? graph.nodes.get(id) : undefined;
  if (node?.type === T.scene) return sceneText(sceneInfo(graph, node)) + '\n';
  if (node?.type === T.episode) return episodeText(episodeInfo(graph, node)) + '\n';
  const seasonText = (s: NodeInstance) => {
    const eps = from(graph, s.id, 'episodes')
      .map((e) => episodeInfo(graph, e))
      .sort((a, b) => a.number - b.number);
    const desc = String(s.params.description ?? '').trim();
    return [`${dramaName(s).toUpperCase()} (${Number(s.params.number ?? 1)}), ${eps.length} episodes, ${runtime(eps.reduce((t, e) => t + e.duration, 0))}${desc ? `\n${desc}` : ''}`, ...eps.map(episodeText)].join('\n\n');
  };
  if (node?.type === T.season) return seasonText(node) + '\n';
  const all = [...graph.nodes.values()];
  const parts = [
    ...all.filter((n) => n.type === T.season).map(seasonText),
    ...all.filter((n) => n.type === T.episode && !into(graph, n.id).length).map((e) => episodeText(episodeInfo(graph, e))),
    ...all.filter((n) => n.type === T.scene && !into(graph, n.id).length).map((s) => sceneText(sceneInfo(graph, s))),
  ];
  return (parts.join('\n\n') || 'Nothing to list yet: wire shots into scenes and scenes into episodes.') + '\n';
}

const oneLineText = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

function costumeText(graph: Graph, n: NodeInstance): string {
  const who = from(graph, n.id, 'character')[0];
  const lines = [`${dramaName(n)}: costume for ${who ? dramaName(who) : 'no one yet'}`];
  const desc = String(n.params.description ?? '').trim();
  if (desc) lines.push(desc);
  const scenes = into(graph, n.id).filter((x) => x.type === T.scene);
  lines.push('', scenes.length ? `Worn in ${scenes.length} scene${scenes.length > 1 ? 's' : ''}:` : 'Not wired into any scene yet.');
  for (const sc of scenes) {
    const ep = into(graph, sc.id).find((x) => x.type === T.episode);
    lines.push(`  ${ep ? `Ep ${Number(ep.params.number ?? 1)} ${dramaName(ep)} · ` : ''}Scene ${Number(sc.params.number ?? 1)}`);
  }
  return lines.join('\n') + '\n';
}

function castText(graph: Graph, n: NodeInstance): string {
  const what = n.type === T.character ? 'Character' : n.type === T.location ? `Location (${n.params.setting ?? 'INT'})` : 'Prop';
  const lines = [`${dramaName(n)}: ${what}`];
  if (n.params.actor) lines.push(`Played by ${n.params.actor}`);
  const desc = String(n.params.description ?? '').trim();
  if (desc) lines.push(desc);
  const look = String(n.params.appearance ?? '').trim();
  if (look) lines.push(`Appearance: ${look}`);
  const apps = appearances(graph, n.id);
  lines.push('', apps.length ? `In ${apps.length} shot${apps.length > 1 ? 's' : ''}:` : 'Not in any shot yet.');
  for (const a of apps) {
    const sc = a.scene ? `Scene ${Number(a.scene.params.number ?? 1)}` : 'no scene';
    const ep = a.episode ? `Ep ${Number(a.episode.params.number ?? 1)} ${dramaName(a.episode)} · ` : '';
    const where = n.type === T.location ? (a.shot.characters.length ? ` with ${names(a.shot.characters)}` : '') : a.shot.location ? ` at ${dramaName(a.shot.location)}` : '';
    lines.push(`  ${ep}${sc} · shot ${a.shot.number} (${a.shot.framing})${where}`);
  }
  return lines.join('\n') + '\n';
}

const details = (node: NodeInstance, ctx: { graph: Graph }) => {
  const g = ctx.graph;
  if (node.type === T.shot || node.type === T.scene || node.type === T.episode || node.type === T.season) {
    const script = seedanceScript(g, node.id);
    const n = script.shots.length;
    const images = script.shots.reduce((t, s) => t + s.refs.length, 0);
    const title = node.type === T.shot ? script.title : node.type === T.scene ? `Scene ${Number(node.params.number ?? 1)}` : dramaName(node);
    // A quick price tag: the first model in the rate table (Pro by default), one take.
    const [model, credits] = Object.entries(script.cost.credits)[0] ?? ['', 0];
    const price = model ? ` · ~${credits.toLocaleString('en')} credits (${model})` : '';
    const subtitle =
      (script.kind === 'shot'
        ? `Seedance shot · ${script.shots[0].duration} s · ${images} reference image${images === 1 ? '' : 's'}`
        : `Seedance script · ${n} shot pack${n === 1 ? '' : 's'}${script.storyboard.length ? ` · storyboard` : ''}`) + price;
    const save = (filename: string, data: Blob | string) => void Promise.resolve(saveDramaFile({ filename, data })).catch(() => undefined);
    return {
      title,
      subtitle,
      code: { lang: 'md', text: script.markdown },
      actions: [
        {
          label: script.kind === 'shot' ? 'Download shot (.zip)' : 'Download pack (.zip)',
          primary: true,
          run: () => void seedancePack(g, node.id).then((p) => save(p.filename, p.blob)).catch((e) => console.error('Seedance export failed', e)),
        },
        { label: script.rootFile, run: () => save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${script.rootFile}`, script.markdown) },
      ],
    };
  }
  if (node.type === T.costume) return { title: dramaName(node), subtitle: 'Costume', code: { lang: 'text', text: costumeText(g, node) } };
  return { title: dramaName(node), subtitle: 'Appearances', code: { lang: 'text', text: castText(g, node) } };
};

/** The details card drama nodes show (Seedance script, appearances): reused by drama boards. */
export const DRAMA_DETAILS = details;

// ------------------------------------------------------------------ engine

export interface DramaStatus {
  kind: string;
  /** One-line summary shown on the node. */
  line: string;
  /** Extra detail (cast list, slugline). */
  sub?: string;
  /** Pictures to show as a filmstrip (scenes: storyboard, or the first frame of each shot). */
  strip?: string[];
  warnings: string[];
}

/**
 * Breaks a production down: each node learns where it is used (characters: which scenes and
 * shots; scenes: slugline, cast, running time; episodes: scenes, shots, cast, runtime) and
 * what is missing (shots without a location, empty scenes, duplicate scene numbers).
 */
export const dramaEngine: GraphEngine = {
  name: 'Drama breakdown',
  callable: false,
  async run({ graph, publish }) {
    const all = [...graph.nodes.values()];
    const has = (type: string) => all.some((n) => n.type === type);
    const count: Record<string, number> = {};
    let warnings = 0;
    for (const n of all) {
      count[n.type] = (count[n.type] ?? 0) + 1;
      const st: DramaStatus = { kind: n.type.replace('drama/', ''), line: '', warnings: [] };
      if (n.type === T.character || n.type === T.location || n.type === T.prop) {
        const apps = appearances(graph, n.id);
        const scenes = uniq(apps.map((a) => a.scene).filter(Boolean)).length;
        st.line = apps.length ? `${scenes} scene${scenes === 1 ? '' : 's'} · ${apps.length} shot${apps.length === 1 ? '' : 's'}` : 'Not in any shot yet';
        if (n.type === T.character && n.params.actor) st.sub = `Played by ${n.params.actor}`;
      } else if (n.type === T.costume) {
        const who = from(graph, n.id, 'character')[0];
        const scenes = into(graph, n.id).filter((x) => x.type === T.scene).length;
        st.line = `${who ? dramaName(who) : 'No character'} · ${scenes ? `${scenes} scene${scenes === 1 ? '' : 's'}` : 'not in a scene yet'}`;
        if (!who) st.warnings.push('Not linked to a character');
      } else if (n.type === T.shot) {
        const s = shotInfo(graph, n);
        st.line = `${s.framing} · ${s.duration}s${s.movement !== 'Static' ? ` · ${s.movement.toLowerCase()}` : ''}`;
        st.sub = [s.location ? dramaName(s.location) : '', names(s.characters)].filter(Boolean).join(' · ') || undefined;
        if (!s.location) st.warnings.push('No location');
        if (has(T.scene) && !into(graph, n.id).length) st.warnings.push('Not in a scene');
      } else if (n.type === T.scene) {
        const s = sceneInfo(graph, n);
        st.line = `${s.shots.length} shot${s.shots.length === 1 ? '' : 's'} · ${runtime(s.duration)}`;
        st.sub = `${s.slug}${s.characters.length ? `\n${names(s.characters)}` : ''}`;
        st.strip = s.storyboard.length ? s.storyboard : s.shots.map((sh) => sh.images[0]).filter(Boolean);
        if (!s.shots.length) st.warnings.push('No shots');
        const worn = new Map<string, number>();
        for (const c of s.costumes) if (c.character) worn.set(c.character.id, (worn.get(c.character.id) ?? 0) + 1);
        for (const [id, k] of worn) {
          const who = dramaName(graph.nodes.get(id)!);
          if (k > 1) st.warnings.push(`Two costumes for ${who}`);
          else if (!s.characters.some((c) => c.id === id)) st.warnings.push(`${who} has a costume but isn’t in any shot`);
        }
        if (has(T.episode) && !into(graph, n.id).length) st.warnings.push('Not in an episode');
      } else if (n.type === T.episode) {
        const e = episodeInfo(graph, n);
        st.line = `Episode ${e.number} · ${e.scenes.length} scene${e.scenes.length === 1 ? '' : 's'} · ${e.shots} shots · ${runtime(e.duration)}`;
        st.sub = e.characters.length ? `Cast: ${names(e.characters)}` : undefined;
        const nums = e.scenes.map((s) => s.number);
        const dup = uniq(nums.filter((x, i) => nums.indexOf(x) !== i));
        if (dup.length) st.warnings.push(`Two scenes numbered ${dup.join(', ')}`);
        if (!e.scenes.length) st.warnings.push('No scenes');
      } else if (n.type === T.season) {
        const eps = from(graph, n.id, 'episodes').map((e) => episodeInfo(graph, e));
        st.line = `${eps.length} episode${eps.length === 1 ? '' : 's'} · ${runtime(eps.reduce((t, e) => t + e.duration, 0))}`;
        const nums = eps.map((e) => e.number);
        const dup = uniq(nums.filter((x, i) => nums.indexOf(x) !== i));
        if (dup.length) st.warnings.push(`Two episodes numbered ${dup.join(', ')}`);
      } else continue;
      warnings += st.warnings.length;
      publish(n.id, { status: st.warnings.length ? 'error' : 'ok', error: st.warnings.join(' · ') || undefined, outputs: { drama: st } });
    }
    const runtimeAll = all.filter((n) => n.type === T.shot).reduce((t, n) => t + shotInfo(graph, n).duration, 0);
    const c = (t: string) => count[t] ?? 0;
    const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    return {
      outputs: {
        episodes: c(T.episode),
        scenes: c(T.scene),
        shots: c(T.shot),
        characters: c(T.character),
        locations: c(T.location),
        runtime: runtimeAll,
        warnings,
        summary: [plural(c(T.episode), 'episode'), plural(c(T.scene), 'scene'), plural(c(T.shot), 'shot'), plural(c(T.character), 'character'), runtime(runtimeAll)].join(' · ') + (warnings ? ` · ${plural(warnings, 'warning')}` : ''),
      },
    };
  },
};

// ------------------------------------------------------------------ view

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const dramaView = {
  render(el: HTMLElement, r: NodeResult | undefined, node: NodeInstance) {
    const s = r?.outputs?.drama as DramaStatus | undefined;
    if (!s) {
      el.textContent = '';
      return;
    }
    const strip = s.strip?.length
      ? `<div class="dr-strip">${s.strip
          .slice(0, 6)
          .map((src) => `<i style="background-image:url(&quot;${esc(src.replace(/"/g, '%22'))}&quot;)"></i>`)
          .join('')}</div>`
      : '';
    el.innerHTML = `<div class="dr-status" data-kind="${esc(s.kind)}">${strip}<b>${esc(s.line)}</b>${s.sub ? `<span>${esc(s.sub)}</span>` : ''}</div>`;
    const stripEl = el.querySelector<HTMLElement>('.dr-strip');
    if (stripEl && s.strip) stripEl.addEventListener('click', () => openLightbox(s.strip!, 0, node.label ?? `Scene ${node.params.number ?? ''}`));
  },
};

const css = `
.dr-images { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dr-thumb { position: relative; width: 64px; height: 44px; flex: none; }
.dr-view { all: unset; box-sizing: border-box; display: block; width: 100%; height: 100%; border-radius: 6px; background: color-mix(in srgb, var(--_muted) 15%, var(--_node)) center / cover no-repeat;
  border: 1px solid var(--_border); cursor: zoom-in; }
.dr-view:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
.dr-rm { all: unset; position: absolute; top: -7px; right: -7px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
  background: var(--_node); color: var(--_text); border: 1px solid var(--_border); font: 600 14px/1 var(--_font); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.nm-node:not(.nm-selected) .dr-rm { display: none; }
.nm-root[data-readonly] :is(.dr-rm, .dr-mv, .dr-add, .dr-gen) { display: none !important; }
.dr-mv { all: unset; position: absolute; bottom: -8px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  background: var(--_node); color: var(--_text); border: 1px solid var(--_border); font: 700 14px/1 var(--_font); box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.dr-mv-l { left: -6px; }
.dr-mv-r { right: -6px; }
.dr-mv:disabled { display: none; }
.dr-mv:focus-visible { outline: 2px solid var(--_accent); }
.nm-node:not(.nm-selected) .dr-mv { display: none; }
.dr-images:has(.dr-mv) { gap: 14px 16px; }
.dr-add { all: unset; box-sizing: border-box; min-width: 44px; height: 44px; padding: 0 12px; border-radius: 6px; border: 1.5px dashed var(--_border);
  color: var(--_muted); font: 500 12px/1 var(--_font); display: grid; place-items: center; cursor: pointer; }
.dr-add:hover, .dr-add:focus-within { border-color: var(--_accent); color: var(--_accent); }
.dr-add { position: relative; overflow: hidden; }
.dr-gen { all: unset; box-sizing: border-box; width: 44px; height: 44px; border-radius: 6px; border: 1.5px dashed var(--_border); display: grid; place-items: center;
  cursor: pointer; font-size: 18px; }
.dr-gen:hover, .dr-gen:focus-visible { border-color: var(--_accent); }
.nm-node:not(.nm-selected) .dr-gen { display: none; }
.dr-gen-note { flex-basis: 100%; color: var(--_muted); font-size: 11px; }
.dr-gen-panel { flex-basis: 100%; display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px dashed var(--_accent); border-radius: 8px;
  background: color-mix(in srgb, var(--_accent) 6%, var(--_node)); }
.dr-gen-panel textarea { font: 12px/1.4 var(--_font); resize: vertical; min-height: 64px; }
.dr-gen-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dr-gen-refs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.dr-gen-ref { flex: none; width: 64px; display: flex; flex-direction: column; gap: 2px; padding: 3px; border: 2px solid transparent; border-radius: 8px;
  background: none; color: inherit; font: 10px/1.2 var(--_font); cursor: pointer; opacity: .45; }
.dr-gen-ref[aria-pressed="true"] { border-color: var(--_accent); opacity: 1; }
.dr-gen-ref img { width: 54px; height: 54px; object-fit: cover; border-radius: 5px; display: block; }
.dr-gen-ref span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.dr-gen-refs-note, .dr-gen-cost { opacity: .75; font-size: 11px; }
.dr-gen-cost:empty { display: none; }
.dr-gen-row select { font: 12px var(--_font); min-height: 28px; }
.dr-gen-key { display: flex; flex-direction: column; gap: 3px; }
.dr-gen-key:empty { display: none; }
.dr-gen-key input { font: 12px var(--_mono, monospace); min-height: 32px; flex: 1 1 140px; min-width: 0; }
.dr-key-masked { -webkit-text-security: disc; }
.dr-gen-link-btn { all: unset; cursor: pointer; font-size: 11.5px; color: var(--_accent); text-decoration: underline; align-self: flex-start; }
.dr-gen-key small { color: var(--_muted); font-size: 11px; }
.dr-gen-go { font: 600 12px var(--_font); padding: 6px 12px; border-radius: 999px; border: 0; background: var(--_accent); color: #fff; cursor: pointer; }
.dr-gen-go:disabled { opacity: .6; cursor: progress; }
.dr-gen-cancel { font: 12px var(--_font); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--_border); background: transparent; color: var(--_text); cursor: pointer; }
.dr-gen-status { font-size: 11.5px; color: var(--_muted); min-height: 1em; }
.dr-clip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dr-clip-btn { font: 12px var(--_font); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--_border); background: transparent; color: var(--_text); cursor: pointer; }
.dr-clip-btn:hover, .dr-clip-btn:focus-visible { border-color: var(--_accent); }
.dr-clip-thumb { all: unset; cursor: zoom-in; border-radius: 6px; overflow: hidden; line-height: 0; border: 1px solid var(--_border); }
.dr-clip-thumb img { width: 80px; height: 45px; object-fit: cover; display: block; }
.dr-clip small { flex-basis: 100%; color: var(--_muted); font-size: 11px; }
.dr-clip small:empty { display: none; }
.dr-clip-panel { flex-basis: 100%; }
.dr-clip-panel select, .dr-clip-panel input[type=number] { font: 12px var(--_font); min-height: 28px; }
.dr-clip-panel .dr-gen-row { flex-wrap: wrap; }
.dr-clip-panel .dr-gen-row > select { width: auto; flex: 1 1 72px; min-width: 0; }
.dr-clip-panel .dr-gen-row > select[aria-label="Model"] { flex-basis: 100%; }
.dr-clip-dur { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; font-size: 12px; }
.dr-clip-panel .dr-clip-dur input[type=number] { width: 52px !important; min-width: 0; }
.dr-clip-sound { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
.dr-clip-watch { text-decoration: none; }
.dr-clip-job { font-size: 12px; color: var(--_text); }
.dr-gen-refwrap { flex: none; display: flex; flex-direction: column; align-items: stretch; gap: 2px; }
.dr-gen-pick { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; font: 600 10px/1 var(--_font); color: var(--_accent);
  padding: 4px 2px; border: 1px solid var(--_border); border-radius: 6px; background: var(--_node); }
.dr-gen-pick:hover, .dr-gen-pick:focus-visible { border-color: var(--_accent); }
.dr-clip-video { flex-basis: 100%; width: 100%; max-width: 320px; aspect-ratio: 16 / 9; border-radius: 6px; background: #000; display: block; }
/* Placeholders while a picture or clip is being made. --pc: percent done (0: unknown, moving). */
.dr-pending { position: relative; flex: none; box-sizing: border-box; border-radius: 6px; overflow: hidden; color: var(--_text);
  background: color-mix(in srgb, var(--_accent) 10%, var(--_node)); border: 1.5px dashed color-mix(in srgb, var(--_accent) 55%, var(--_border)); }
.dr-pending.dr-thumb { display: grid; place-items: center; }
.dr-pending.dr-thumb .dr-pending-meter { width: 30px; height: 30px; border-radius: 50%;
  background: conic-gradient(var(--_accent) calc(var(--pc) * 1%), color-mix(in srgb, var(--_muted) 25%, transparent) 0);
  -webkit-mask: radial-gradient(circle, transparent 10px, #000 11px); mask: radial-gradient(circle, transparent 10px, #000 11px); }
.dr-pending.dr-thumb.dr-indeterminate .dr-pending-meter { background: conic-gradient(var(--_accent) 0 25%, color-mix(in srgb, var(--_muted) 25%, transparent) 0); animation: dr-spin 1s linear infinite; }
.dr-pending.dr-thumb .dr-pending-pc, .dr-pending.dr-thumb .dr-pending-time { position: absolute; inset: 0; display: grid; place-items: center; font: 600 9px/1 var(--_mono, var(--_font)); }
.dr-pending.dr-thumb .dr-pending-label, .dr-pending.dr-thumb:not(.dr-indeterminate) .dr-pending-time, .dr-pending.dr-thumb.dr-indeterminate .dr-pending-pc { display: none; }
.dr-pending.dr-clip-tile { flex-basis: 100%; max-width: 240px; aspect-ratio: 16 / 9; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 2px; padding: 8px 10px 12px; text-align: center;
  background: linear-gradient(110deg, color-mix(in srgb, var(--_accent) 8%, var(--_node)) 30%, color-mix(in srgb, var(--_accent) 20%, var(--_node)) 50%, color-mix(in srgb, var(--_accent) 8%, var(--_node)) 70%) 0 0 / 300% 100%;
  animation: dr-shimmer 2.4s linear infinite; }
.dr-pending.dr-clip-tile::before { content: '🎬'; font-size: 20px; line-height: 1; }
.dr-pending.dr-clip-tile .dr-pending-label { font: 600 12px/1.3 var(--_font); }
.dr-pending.dr-clip-tile .dr-pending-pc { font: 700 16px/1 var(--_font); color: var(--_accent); }
.dr-pending.dr-clip-tile .dr-pending-pc:empty { display: none; }
.dr-pending.dr-clip-tile .dr-pending-time { font: 11px/1 var(--_mono, var(--_font)); opacity: .7; }
.dr-pending.dr-clip-tile .dr-pending-meter { position: absolute; left: 0; bottom: 0; height: 4px; width: calc(var(--pc) * 1%); background: var(--_accent); transition: width .4s; }
.dr-pending.dr-clip-tile.dr-indeterminate .dr-pending-meter { width: 30%; animation: dr-slide 1.6s ease-in-out infinite; }
@keyframes dr-spin { to { transform: rotate(1turn); } }
@keyframes dr-shimmer { from { background-position: 100% 0; } to { background-position: -50% 0; } }
@keyframes dr-slide { 0% { left: -30%; } 100% { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .dr-pending, .dr-pending * { animation: none !important; } }
.dr-gen-link { text-decoration: none; display: inline-block; }
.dr-file { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font-size: 0; }
.dr-status { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--_text); }
.dr-status b { font-weight: 600; }
.dr-status span { color: var(--_muted); white-space: pre-line; font-size: 11.5px; }
.dr-status[data-kind="scene"] span:first-of-type { font-family: var(--_mono); font-size: 11px; }
.dr-strip { display: flex; gap: 3px; margin-bottom: 3px; cursor: zoom-in; }
.dr-strip i { flex: 1 1 0; max-width: 56px; aspect-ratio: 16 / 10; border-radius: 3px; background: color-mix(in srgb, var(--_muted) 15%, var(--_node)) center / cover no-repeat; border: 1px solid var(--_border); }
`;

const nodes: NodeType[] = [locationNode, characterNode, costumeNode, propNode, shotNode, sceneNode, episodeNode, seasonNode].map((n) => ({ ...n, view: dramaView, details }));

export const dramaPack = definePack({
  id: 'nodemap/drama',
  title: 'Drama',
  portTypes,
  paramKinds: [imagesParam, clipFrameParam],
  nodes,
  css,
});
