import { defineNode, definePack, type GraphEngine } from '../core/registry.js';
import type { Graph } from '../core/graph.js';
import type { ChooseOptions, NodeInstance, NodeResult, NodeType, ParamKind, PortTypeDef } from '../core/types.js';
import { saveDramaFile, seedancePack, seedanceScript } from './drama-seedance.js';
import { getImageGenerators, type ImageGenerator } from './image-generation.js';
import { getVideoGenerators, type VideoGenerator, type VideoJob } from './video-generation.js';
import { attachVoiceTrack, getVoiceTools, matchSpeakers, quotedLines, speakersOf, type Speaker, type VoiceTrack } from './voices.js';
import { NM_OPEN_FIELD } from '../core/types.js';

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
        items: choices.map((src, i) => {
          const v = pictureView(ctx.graph.nodes.get(r.card!), src);
          const hint = [src === r.src ? 'sending this one' : '', v?.description ?? ''].filter(Boolean).join(' · ');
          return { id: String(i), label: v?.name ?? `Picture ${i + 1}`, hint: hint || undefined, image: src };
        }),
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

/** A shot has a new clip: stamp it (shots carrying on from it can tell), and its fixed voices were for the old one. */
function newClip(graph: Graph, shotId: string): void {
  graph.setParam(shotId, 'clipAt', Date.now());
  if (graph.nodes.get(shotId)?.params.voiceTrack) graph.setParam(shotId, 'voiceTrack', null);
}

const usd = (e: { amount: number; unit: string }) => (e.unit === 'USD' ? `$${e.amount.toFixed(2)}` : `${e.amount} credits`);

/** The settings a shot's clip gets without the panel: its length and aspect where the model allows, 720p, sound where it can. */
function clipSettings(gen: VideoGenerator, modelId: string, s: ShotClipSuggestion) {
  const m = gen.models.find((x) => x.id === modelId) ?? gen.models[0];
  const d = Math.min(m?.maxDuration ?? 60, Math.max(m?.minDuration ?? 1, s.duration || 5));
  const duration = m?.durations?.length ? m.durations.reduce((a, b) => (Math.abs(b - d) <= Math.abs(a - d) ? b : a)) : Math.round(d);
  const aspect = !m?.aspects || m.aspects.includes(s.aspect) ? s.aspect : m.aspects[0];
  const resolution = !m?.resolutions || m.resolutions.includes('720p') ? '720p' : m.resolutions[0];
  return { model: m?.id ?? modelId, label: m?.label ?? modelId, duration, aspect, resolution, audio: !!m?.audio };
}

/** What making a shot's clip this way will cost (undefined: the service doesn't say). */
export function shotClipEstimate(gen: VideoGenerator, modelId: string, s: ShotClipSuggestion) {
  const c = clipSettings(gen, modelId, s);
  return gen.estimate?.({ model: c.model, duration: c.duration, resolution: c.resolution, aspect: c.aspect, audio: c.audio, references: s.references.length });
}

/**
 * Make a shot's clip without its panel (🎬 Make the scene): its own prompt, pictures and first
 * frame, sent, kept, and its first and last frames taken, as 🎬 Clip does. `from` is the stamp of
 * the clip it carries on from. Its card shows the progress.
 */
export async function makeShotClip(
  graph: Graph,
  shotId: string,
  s: ShotClipSuggestion,
  o: { gen: VideoGenerator; model: string; from?: number; signal?: AbortSignal; onProgress?: (text: string, percent?: number) => void },
): Promise<void> {
  const { gen } = o;
  const c = clipSettings(gen, o.model, s);
  const since = Date.now();
  const live = (text: string, percent?: number) => {
    liveClips.set(shotId, { text, since, ...(percent != null ? { percent } : {}) });
    document.dispatchEvent(new CustomEvent(CLIP_PROGRESS, { detail: shotId }));
    o.onProgress?.(text, percent);
  };
  let submitted = false;
  try {
    live('Preparing pictures…');
    const picked = await Promise.all(s.references.map((r) => referencePicture(r.src)));
    const first = s.firstFrame ? await referencePicture(s.firstFrame) : undefined;
    live(`Asking ${gen.name}…`);
    const e = shotClipEstimate(gen, o.model, s);
    const record = (result?: string[]) =>
      logGeneration({
        at: Date.now(),
        kind: 'clip',
        node: shotId,
        param: 'lastFrame',
        service: gen.name,
        model: c.label,
        prompt: s.prompt,
        references: s.references.map((r) => ({ label: r.label, ...(linkOnly(r.src) ? { src: r.src } : {}) })),
        settings: { duration: c.duration, aspect: c.aspect, resolution: c.resolution, sound: c.audio, scene: true },
        ...(result ? { result } : {}),
        ...(e ? { cost: `about ${usd(e)}` } : {}),
      });
    const result = await gen.generate({
      prompt: s.prompt,
      references: picked,
      firstFrame: first,
      duration: c.duration,
      aspect: c.aspect,
      resolution: c.resolution,
      model: c.model,
      audio: c.audio,
      signal: o.signal,
      onProgress: live,
      onSubmitted: (job) => {
        submitted = true;
        record();
        collecting.add(`${shotId}:${job.startedAt}`);
        graph.setParam(shotId, 'clipJob', job);
        graph.setParam(shotId, 'clipFrom', s.firstFrame ? (o.from ?? null) : null);
      },
    });
    const clip = result.videos[0];
    if (!clip) throw new Error(`${gen.name} returned no clip`);
    live('Saving a copy of the clip…');
    let kept = clip;
    if (clipKeeper) kept = await clipKeeper(clip, { shotId }).catch(() => clip);
    keepTried.add(kept);
    graph.setParam(shotId, 'clipUrl', kept);
    graph.setParam(shotId, 'clipJob', null);
    newClip(graph, shotId);
    live('Taking the last frame…');
    posterTried.add(kept);
    const f = await clipFramesOf(await (await fetch(kept, { signal: o.signal, credentials: 'same-origin' })).blob());
    graph.setParam(shotId, 'clipPoster', f.first);
    if (Number.isFinite(f.seconds)) graph.setParam(shotId, 'clipSeconds', Math.round(f.seconds * 10) / 10);
    graph.setParam(shotId, 'lastFrame', f.last);
  } catch (err) {
    if (submitted && (err as { code?: string }).code !== 'pending' && (err as Error).name !== 'AbortError') graph.setParam(shotId, 'clipJob', null);
    throw err;
  } finally {
    for (const k of collecting) if (k.startsWith(`${shotId}:`)) collecting.delete(k);
    liveClips.delete(shotId);
    document.dispatchEvent(new CustomEvent(CLIP_PROGRESS, { detail: shotId }));
  }
}

/** One of a scene's shots, for 🎬 Make the scene. */
export interface SceneShot {
  id: string;
  label: string;
  /** Carries straight on from the shot before (so it waits for that one's clip). */
  continues: boolean;
  hasClip: boolean;
  /** Why its clip is out of date, if it is. */
  stale?: string;
  /** Its prompt and pictures, worked out when it's sent (after the shot before has its new clip). */
  suggest(): ShotClipSuggestion | undefined;
  /** The stamp of the clip before it (when it starts from that one's last frame). */
  from(): number | undefined;
}

/**
 * 🎬 Make the scene: its shots' clips, made in order. Shots that carry on from the one before
 * wait for its new clip and start from its last frame; the rest (cuts) are made at the same
 * time. Shots without a clip, or out of date, are ticked; tick others to remake them.
 */
export const sceneClipsParam: ParamKind = {
  kind: 'scene-clips',
  render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'dr-scene-clips';
    const el = (tag: string, attrs: Record<string, string> = {}, text = '') => {
      const x = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
      if (text) x.textContent = text;
      return x;
    };
    const shotsOf = () => (ctx.param as { shots?: (n: NodeInstance, g: Graph) => SceneShot[] }).shots?.(ctx.node, ctx.graph) ?? [];
    let gen: VideoGenerator | null = preferred('video', getVideoGenerators());
    let model = gen?.defaultModel ?? gen?.models[0]?.id ?? '';
    const ticked = new Set(shotsOf().filter((s) => !s.hasClip || s.stale).map((s) => s.id));
    const state = new Map<string, string>();
    let abort: AbortController | undefined;
    let running = false;
    const draw = () => {
      wrap.replaceChildren();
      const gens = getVideoGenerators();
      if (!gen) return void wrap.append(el('p', {}, 'Set up a video service first.'));
      wrap.append(el('p', { class: 'dr-scene-clips-intro' }, 'Makes the ticked shots’ clips. A shot that carries on from the one before waits for its new clip and starts from its last frame; cuts are made at the same time. Keep this page open until it’s done.'));
      const head = el('div', { class: 'dr-gen-row' });
      if (gens.length > 1) {
        const sv = el('select', { 'aria-label': 'Service' }) as HTMLSelectElement;
        for (const g of gens) sv.append(Object.assign(document.createElement('option'), { value: g.id, textContent: g.name }));
        sv.value = gen.id;
        sv.disabled = running;
        sv.addEventListener('change', () => {
          gen = gens.find((g) => g.id === sv.value) ?? gen;
          remember('video', gen!.id);
          model = gen!.defaultModel ?? gen!.models[0]?.id ?? '';
          draw();
        });
        head.append(sv);
      }
      const md = el('select', { 'aria-label': 'Model' }) as HTMLSelectElement;
      for (const m of gen.models) md.append(Object.assign(document.createElement('option'), { value: m.id, textContent: m.label }));
      md.value = model;
      md.disabled = running;
      md.addEventListener('change', () => ((model = md.value), draw()));
      head.append(md);
      wrap.append(head);
      const shots = shotsOf();
      const list = el('div', { class: 'dr-scene-clips-list' });
      let total = 0;
      let priced = true;
      shots.forEach((s, i) => {
        const row = el('label', { class: 'dr-scene-clip' });
        const box = el('input', { type: 'checkbox' }) as HTMLInputElement;
        box.checked = ticked.has(s.id);
        box.disabled = running;
        box.addEventListener('change', () => (box.checked ? ticked.add(s.id) : ticked.delete(s.id), draw()));
        const note = state.get(s.id) ?? (s.stale ? `⚠ ${s.stale}` : s.hasClip ? 'has a clip' : 'no clip yet');
        const carry = s.continues && i > 0 ? ' · carries on from the one before' : '';
        row.append(box, el('span', { class: 'dr-scene-clip-name' }, s.label), el('small', {}, `${note}${carry}`));
        list.append(row);
        if (ticked.has(s.id)) {
          let sg: ShotClipSuggestion | undefined;
          try {
            sg = s.suggest();
          } catch {
            sg = undefined;
          }
          const e = sg && shotClipEstimate(gen!, model, sg);
          if (e) total += e.amount;
          else priced = false;
        }
      });
      wrap.append(list);
      const n = shots.filter((s) => ticked.has(s.id)).length;
      const go = el('button', { type: 'button', class: 'dr-gen-go' }, running ? 'Making…' : `🎬 Make ${n} clip${n === 1 ? '' : 's'}${n && priced && total ? ` · about $${total.toFixed(2)}` : ''}`) as HTMLButtonElement;
      go.disabled = running || !n;
      const stop = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Stop') as HTMLButtonElement;
      stop.hidden = !running;
      stop.addEventListener('click', () => abort?.abort());
      go.addEventListener('click', async () => {
        const g = gen!;
        if (g.key && !g.key.get()) return void state.set('_', `Add your ${g.key.label} first.`), draw();
        if (!(await confirmSpend(go, g.name, Promise.resolve(priced && total ? { amount: Math.round(total * 100) / 100, unit: 'USD' } : undefined), g.balance?.()))) return;
        running = true;
        abort = new AbortController();
        state.clear();
        const todo = shotsOf();
        for (const s of todo) if (ticked.has(s.id)) state.set(s.id, 'waiting…');
        draw();
        // Each shot's clip, once the one it carries on from (if that's being made too) is done.
        const done = new Map<string, Promise<void>>();
        todo.forEach((s, i) => {
          if (!ticked.has(s.id)) return;
          const before = s.continues && i > 0 ? done.get(todo[i - 1].id) : undefined;
          done.set(
            s.id,
            (async () => {
              if (before) {
                try {
                  await before;
                } catch {
                  state.set(s.id, `not made: ${todo[i - 1].label} didn’t finish`);
                  draw();
                  throw new Error('skipped');
                }
              }
              const sg = s.suggest();
              if (!sg) throw new Error('no prompt');
              try {
                await makeShotClip(ctx.graph, s.id, sg, {
                  gen: g,
                  model,
                  from: s.from(),
                  signal: abort!.signal,
                  onProgress: (t, pc) => {
                    state.set(s.id, pc != null ? `${t} ${Math.round(pc)}%` : t);
                    if (wrap.isConnected) draw();
                  },
                });
                state.set(s.id, '✓ made');
              } catch (err) {
                state.set(s.id, (err as Error).name === 'AbortError' ? 'stopped' : `failed: ${(err as Error).message}`);
                throw err;
              } finally {
                ticked.delete(s.id);
                if (wrap.isConnected) draw();
              }
            })(),
          );
        });
        await Promise.allSettled(done.values());
        running = false;
        draw();
      });
      wrap.append(el('div', { class: 'dr-gen-row' }), go, stop);
      if (state.get('_')) wrap.append(el('small', { role: 'status' }, state.get('_')!));
    };
    draw();
    return wrap;
  },
};

/** Service links already offered to the keeper on this page. */
const keepTried = new Set<string>();
/**
 * Clips being made from this page, by shot: what the service says, and the percent. The field
 * that sent it updates it; the shot's card (another view of the same shot) shows it.
 */
const liveClips = new Map<string, Pending>();
const CLIP_PROGRESS = 'dr-clip-progress';
/** Pictures being made from this page, by `node:param`: the field making it shares, the card shows. */
const liveImages = new Map<string, Pending>();
const IMAGE_PROGRESS = 'dr-image-progress';
/** Dispatched on a picture or clip field to open its generate panel (the cards' ✨ / 🎬 buttons). */
export const GENERATE_EVENT = 'dr-generate';
/** Dispatched on a clip field to open ✏️ Change this clip. */
export const EDIT_EVENT = 'dr-edit-clip';

/**
 * A prompt laid out for reading on a phone: its parts under headings (style, characters,
 * setting, props, scene, the shot itself, rules), each @ImageN shown as its picture, and any
 * checks first. `refs` are the pictures in the order they're sent.
 */
export function promptReview(
  prompt: string,
  refs: { src: string; label: string }[],
  checks: string[] = [],
  opts: { first?: string; pictures?: { src: string; label: string }[] } = {},
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'dr-review';
  if (checks.length) {
    const c = document.createElement('div');
    c.className = 'dr-review-checks';
    c.append(Object.assign(document.createElement('strong'), { textContent: `Worth a look (${checks.length})` }));
    const ul = document.createElement('ul');
    for (const t of checks) ul.append(Object.assign(document.createElement('li'), { textContent: t }));
    c.append(ul);
    box.append(c);
  }
  // Text with each @ImageN as a small picture and its number.
  const rich = (text: string) => {
    const p = document.createElement('p');
    for (const part of text.split(/(@Image\d+)/)) {
      const m = /^@Image(\d+)$/.exec(part);
      const r = m ? refs[Number(m[1]) - 1] : undefined;
      if (m) {
        const tag = document.createElement('span');
        tag.className = 'dr-review-ref';
        tag.title = r?.label ?? `${part}: not sent`;
        if (r) tag.append(Object.assign(document.createElement('img'), { src: r.src, alt: '' }));
        tag.append(m[1]);
        if (!r) tag.classList.add('dr-review-missing');
        p.append(tag);
      } else if (part) p.append(part);
    }
    return p;
  };
  const section = (title: string, cls = '') => {
    const s = document.createElement('section');
    s.className = `dr-review-part ${cls}`.trim();
    s.append(Object.assign(document.createElement('h4'), { textContent: title }));
    box.append(s);
    return s;
  };
  const lines = prompt.split('\n').map((l) => l.trim());
  let cur: HTMLElement | undefined;
  lines.forEach((line, i) => {
    if (!line) return void (cur = undefined);
    const head = /^([A-Z][A-Za-z ]{1,24})(\s*\([^)]*\))?:\s*(.*)$/.exec(line);
    if (i === 0 && !head) return void section(opts.first ?? 'Style').append(rich(line));
    const key = head?.[1].trim();
    // "Characters:" or "On screen:" on its own: a list follows ("- …").
    if (head && !head[3]) return void (cur = section(key!));
    if (line.startsWith('- ') && cur) return void cur.append(rich(line.slice(2)));
    if (head) {
      const name = key === 'Shot' ? `Shot ${head[2]?.trim() ?? ''}`.trim() : key === 'Scene context' ? 'Scene' : key!;
      cur = section(name, key === 'Shot' || key === 'Action' ? 'dr-review-shot' : key === 'Rules' ? 'dr-review-rules' : '');
      if (head[3]) cur.append(rich(head[3]));
      return;
    }
    if (/^(Keep|One continuous|No subtitles)/.test(line)) return void section('Rules', 'dr-review-rules').append(rich(line));
    (cur ?? section('More')).append(rich(line));
  });
  // Pictures sent with a prompt that doesn't name them (pictures, not clips): numbered, in order.
  if (opts.pictures?.length) {
    const sec = section(`Pictures sent (${opts.pictures.length})`);
    const list = document.createElement('div');
    list.className = 'dr-review-pics';
    opts.pictures.forEach((p, k) => {
      const item = document.createElement('span');
      item.append(Object.assign(document.createElement('img'), { src: p.src, alt: '' }), `${k + 1}. ${p.label}`);
      list.append(item);
    });
    sec.append(list);
    // Pictures first: what the AI looks at, then what it's told.
    box.insertBefore(sec, box.querySelector('.dr-review-part'));
  }
  return box;
}

/** An amount in a service's unit: $1.94, or 3 credits. */
const amountText = (n: number, unit: string | undefined) => (unit === 'USD' ? `$${n.toFixed(2)}` : `${n.toLocaleString()} credit${n === 1 ? '' : 's'}`);

/**
 * Before spending: what it will probably cost and what's left ("Uses about 3 of 1,234 credits on
 * Meshy"), with ✓ Generate and Back, shown under the Generate button. Resolves true to go ahead.
 */
export function confirmSpend(
  go: HTMLButtonElement,
  service: string,
  estimate: Promise<{ amount: number; unit?: string } | undefined>,
  balance: Promise<number | undefined> | undefined,
): Promise<boolean> {
  const box = document.createElement('div');
  box.className = 'dr-confirm';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', 'Confirm');
  const text = Object.assign(document.createElement('div'), { className: 'dr-confirm-text', textContent: 'Checking the cost…' });
  const yes = Object.assign(document.createElement('button'), { type: 'button', className: 'dr-gen-go', textContent: '✓ Generate', disabled: true });
  const no = Object.assign(document.createElement('button'), { type: 'button', className: 'dr-gen-cancel', textContent: 'Back' });
  const row = document.createElement('div');
  row.className = 'dr-gen-row';
  row.append(yes, no);
  box.append(text, row);
  const at = go.closest('.dr-gen-row') ?? go;
  at.after(box);
  at.setAttribute('hidden', '');
  // Don't wait long: a slow balance shouldn't hold things up.
  const soon = <T,>(p: Promise<T> | undefined) => Promise.race([(p ?? Promise.resolve(undefined)).catch(() => undefined), new Promise<undefined>((r) => setTimeout(r, 6000))]);
  void Promise.all([soon(estimate), soon(balance)]).then(([e, b]) => {
    const unit = e?.unit ?? (service === 'fal' ? 'USD' : 'credits');
    const left = typeof b === 'number' ? b : undefined;
    text.textContent = e
      ? left != null
        ? unit === 'USD'
          ? `Uses about ${amountText(e.amount, unit)} of ${amountText(left, unit)} on ${service}.`
          : `Uses about ${e.amount.toLocaleString()} of ${left.toLocaleString()} credits on ${service}.`
        : `Uses about ${amountText(e.amount, unit)} on ${service}. (Your balance couldn’t be read${service === 'fal' ? ': fal shows it only to keys with billing access' : ''}.)`
      : `${service} will charge for this; the cost isn’t known yet${left != null ? ` · ${amountText(left, unit)} left` : ''}.`;
    if (e && left != null && e.amount > left) text.textContent += ' That’s more than your balance.';
    yes.disabled = false;
  });
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      box.remove();
      at.removeAttribute('hidden');
      resolve(ok);
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
  });
}

/**
 * What made a picture or a clip: the exact prompt, the reference pictures, the service, model
 * and settings, and the result. The host keeps these (Drama Club: for 7 days).
 */
export interface GenerationRecord {
  at: number;
  kind: 'image' | 'clip' | 'voices';
  /** The node and field it was made for. */
  node: string;
  param: string;
  service: string;
  model?: string;
  prompt: string;
  /** In the order sent (@Image1…); `src` only for links (not pictures held inline). */
  references: { label: string; src?: string }[];
  settings?: Record<string, unknown>;
  /** What came back (links), when known. */
  result?: string[];
  cost?: string;
}
export interface GenerationLog {
  save(record: GenerationRecord): void | Promise<void>;
  /** Newest first. */
  list(node: string, param: string): Promise<GenerationRecord[]>;
}
let generationLog: GenerationLog | null = null;
/** Where records of what made each picture and clip go (none: not kept). */
export function setGenerationLog(log: GenerationLog | null): void {
  generationLog = log;
}
/** A link worth keeping in a record (pictures held inline are too big, and on the card anyway). */
const linkOnly = (src: string | undefined) => (src && !src.startsWith('data:') && !src.startsWith('blob:') ? src : undefined);
const logGeneration = (r: GenerationRecord) => {
  try {
    void Promise.resolve(generationLog?.save(r)).catch(() => undefined);
  } catch {
    /* a log that fails mustn't stop the work */
  }
};

/**
 * 🕘 How these were made: the field's records (newest first), each with its time, service,
 * model and settings, the result, and the prompt laid out to read (promptReview).
 */
function generationHistory(node: string, param: string): HTMLElement | undefined {
  if (!generationLog) return undefined;
  const d = document.createElement('details');
  d.className = 'dr-history';
  d.append(Object.assign(document.createElement('summary'), { textContent: '🕘 How these were made (last 7 days)' }));
  const body = document.createElement('div');
  d.append(body);
  d.addEventListener('toggle', async () => {
    if (!d.open || body.dataset.loaded) return;
    body.dataset.loaded = '1';
    body.textContent = 'Loading…';
    try {
      const list = await generationLog!.list(node, param);
      body.textContent = list.length ? '' : 'Nothing generated here in the last 7 days.';
      for (const r of list) {
        const item = document.createElement('details');
        item.className = 'dr-history-item';
        const when = new Date(r.at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const sets = Object.entries(r.settings ?? {})
          .filter(([, v]) => v != null && v !== '' && v !== false)
          .map(([k, v]) => (v === true ? k : k === 'duration' ? `${v} s` : String(v)))
          .join(' · ');
        const sum = document.createElement('summary');
        const pic = r.result?.[0] && r.kind === 'image' ? r.result[0] : undefined;
        if (pic) sum.append(Object.assign(document.createElement('img'), { src: pic, alt: '' }));
        sum.append(`${when} · ${r.service}${r.model ? ` · ${r.model}` : ''}${sets ? ` · ${sets}` : ''}${r.cost ? ` · ${r.cost}` : ''}`);
        item.append(sum, promptReview(r.prompt, r.references.map((x) => ({ src: x.src ?? '', label: x.label })).filter((x) => x.src)));
        if (r.references.some((x) => !x.src)) item.append(Object.assign(document.createElement('small'), { textContent: `Pictures sent: ${r.references.map((x, i) => `${i + 1}. ${x.label}`).join('; ')}` }));
        body.append(item);
      }
    } catch (err) {
      body.textContent = `Couldn’t load them: ${(err as Error).message}`;
    }
  });
  return d;
}

/** Clips whose first frame was already looked for on this page. */
const posterTried = new Set<string>();

/** One shot in a played sequence: its clip, or a still (its frame, else its words) for its length. */
export interface SequenceItem {
  label: string;
  /** The clip. */
  video?: string;
  /** A picture to show (a clip's poster, or the still when there's no clip). */
  image?: string;
  /** What it is, when there's nothing to show. */
  text?: string;
  /** How long a still stays (seconds). */
  seconds: number;
  /** Carries straight on from the one before: a cut, not a crossfade. */
  continues?: boolean;
  /** Its fixed voices (🎙), played instead of the clip's own sound. */
  voices?: VoiceTrack;
}

/**
 * Play shots one after another, full screen with sound: clips crossfade into each other (a cut
 * where a shot continues the one before), shots without a clip show their frame (or their
 * words) for their length, like an animatic. ⏮ ⏯ ⏭ and ✕; Esc or leaving full screen closes it.
 */
export function playSequence(items: SequenceItem[], opts: { title?: string; fade?: number; record?: boolean } = {}): void {
  if (!items.length) return;
  const fade = opts.fade ?? 0.6;
  const box = document.createElement('div');
  box.className = 'dr-player dr-sequence';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', opts.title ?? 'Preview');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;overflow:hidden;';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;';
  // Two video layers, made now (from the tap) so later clips may play with sound; one still layer.
  const mk = () => {
    const v = Object.assign(document.createElement('video'), { playsInline: true, preload: 'auto' });
    v.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity ${fade}s;`;
    return v;
  };
  const vids = [mk(), mk()];
  const still = document.createElement('div');
  still.style.cssText = `position:absolute;inset:0;display:grid;place-items:center;opacity:0;transition:opacity ${fade}s;background:#000 center/contain no-repeat;color:#fff;font:500 20px/1.4 system-ui,sans-serif;text-align:center;padding:32px;white-space:pre-line;`;
  stage.append(...vids, still);
  const cap = document.createElement('div');
  cap.style.cssText = 'position:absolute;left:16px;bottom:max(16px,env(safe-area-inset-bottom));color:#fff;font:600 14px/1.3 system-ui,sans-serif;text-shadow:0 1px 4px #000;pointer-events:none;';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;top:max(12px,env(safe-area-inset-top));right:12px;display:flex;gap:8px;';
  const btn = (text: string, label: string) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
    b.setAttribute('aria-label', label);
    b.style.cssText = 'width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font:18px system-ui,sans-serif;cursor:pointer;';
    return b;
  };
  const prev = btn('⏮', 'Previous shot');
  const pause = btn('⏸', 'Pause');
  const next = btn('⏭', 'Next shot');
  const close = btn('✕', 'Close the preview');
  bar.append(prev, pause, next, close);
  box.append(stage, cap, bar);
  document.body.append(box);

  let i = -1;
  let layer = 0; // which video layer is showing
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stillLeft = 0;
  let stillFrom = 0;
  let paused = false;
  let advancing = false;
  /** The clip showing now (none while a still shows): only its events move things on. */
  let active: HTMLVideoElement | null = null;
  /** Stops the fixed voices of the clip showing. */
  let unvoice: (() => void) | undefined;
  /** The layer holding the next clip, loaded ahead. */
  let preloaded: HTMLVideoElement | null = null;
  /** Counts shots shown: a slow load for one that's been skipped past does nothing. */
  let showing = 0;
  const current = () => vids[layer];
  const hideAll = (except?: HTMLElement) => {
    // A clip fading out keeps playing until it has faded (a cut stops it at once).
    for (const v of vids)
      if (v !== except) {
        v.style.opacity = '0';
        if (v.style.transition === 'none') v.pause();
        else setTimeout(() => v !== active && v.pause(), fade * 1000);
      }
    if (still !== except) still.style.opacity = '0';
  };
  const show = (to: number, cut: boolean) => {
    clearTimeout(timer);
    if (to >= items.length) return rec ? rec.finish() : done();
    i = Math.max(0, to);
    const raw = items[i];
    // Recording can only read clips this site serves (kept clips); others show as their still.
    const it = rec && raw.video && !readable(raw.video) ? { ...raw, video: undefined } : raw;
    cap.textContent = `${rec ? '● Recording · ' : ''}${it.label} · ${i + 1}/${items.length}`;
    if (rec) rec.still(it.video ? undefined : it);
    for (const el of [...vids, still]) el.style.transition = cut ? 'none' : `opacity ${fade}s`;
    const token = ++showing;
    if (it.video) {
      layer = 1 - layer;
      const v = current();
      active = v;
      unvoice?.();
      unvoice = undefined;
      // Loaded already (it was readied while the one before played), else load it now.
      if (preloaded !== v || v.dataset.src !== it.video) {
        v.dataset.src = it.video;
        v.src = it.video;
      }
      preloaded = null;
      v.removeAttribute('poster');
      if (it.voices?.voices.length) unvoice = attachVoiceTrack(v, it.voices, rec?.audio ?? {});
      v.muted = !!it.voices?.voices.length;
      if (v.currentTime) v.currentTime = 0;
      // Shown once its first frame is ready: until then the shot before stays on screen (its
      // last frame, for a cut), never a thumbnail or black.
      const reveal = () => {
        if (token !== showing) return;
        v.style.opacity = '1';
        hideAll(v);
        if (!paused) void v.play()?.catch?.(() => undefined);
        // Ready the next clip in the other layer once this one has faded in.
        setTimeout(() => token === showing && readyNext(i + 1), (cut ? 0 : fade * 1000) + 50);
      };
      if (v.readyState >= 2) reveal();
      else {
        const go = () => (v.removeEventListener('loadeddata', go), v.removeEventListener('error', go), reveal());
        v.addEventListener('loadeddata', go);
        v.addEventListener('error', go);
        v.load?.();
      }
    } else {
      still.style.backgroundImage = it.image ? `url("${it.image.replace(/"/g, '%22')}")` : 'none';
      still.textContent = it.image ? '' : it.text ?? it.label;
      still.style.opacity = '1';
      active = null;
      hideAll(still);
      stillLeft = it.seconds * 1000;
      if (!paused) runStill();
      setTimeout(() => token === showing && readyNext(i + 1), (cut ? 0 : fade * 1000) + 50);
    }
    advancing = false;
  };
  /** Load the next clip into the layer not showing, so it's ready the moment it's needed. */
  function readyNext(n: number) {
    const it = items[n];
    const url = it && !(rec && it.video && !readable(it.video)) ? it.video : undefined;
    const v = vids[1 - layer];
    if (!url || v === active) return;
    v.pause();
    v.style.opacity = '0';
    if (v.dataset.src !== url) {
      v.dataset.src = url;
      v.src = url;
      v.load?.();
    } else if (v.currentTime) v.currentTime = 0;
    preloaded = v;
  }
  // A still moves on after its length (less the fade, so the next fades in as it ends).
  const runStill = () => {
    stillFrom = Date.now();
    const nextCut = items[i + 1]?.continues;
    timer = setTimeout(() => show(i + 1, !!nextCut), Math.max(200, stillLeft - (nextCut ? 0 : fade * 1000)));
  };
  // A clip hands over a fade before its end (or at its end, for a cut).
  for (const v of vids)
    v.addEventListener('timeupdate', () => {
      if (v !== active || advancing || paused || !Number.isFinite(v.duration)) return;
      const nextCut = items[i + 1]?.continues;
      if (!nextCut && v.duration - v.currentTime <= fade) ((advancing = true), show(i + 1, false));
    });
  for (const v of vids)
    v.addEventListener('ended', () => {
      if (v === active && !advancing) ((advancing = true), show(i + 1, true));
    });
  // A clip that won't load: move on.
  for (const v of vids) v.addEventListener('error', () => v === active && v.src && show(i + 1, true));

  const setPaused = (p: boolean) => {
    paused = p;
    pause.textContent = p ? '▶' : '⏸';
    pause.setAttribute('aria-label', p ? 'Play' : 'Pause');
    const it = items[i];
    if (!it) return;
    if (it.video) void (p ? current().pause() : current().play()?.catch?.(() => undefined));
    else if (p) ((stillLeft -= Date.now() - stillFrom), clearTimeout(timer));
    else runStill();
  };
  let shown = false;
  function done() {
    loading.abort();
    setTimeout(() => blobs.forEach((b) => URL.revokeObjectURL(b)), 1000);
    clearTimeout(timer);
    unvoice?.();
    rec?.cancel();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFull);
    for (const v of vids) (v.pause(), v.removeAttribute('src'), v.load());
    if (document.fullscreenElement === box) void document.exitFullscreen?.().catch(() => undefined);
    box.remove();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done();
    else if (e.key === ' ') (e.preventDefault(), setPaused(!paused));
    else if (e.key === 'ArrowRight') show(i + 1, true);
    else if (e.key === 'ArrowLeft') show(i - 1, true);
  };
  const onFull = () => (document.fullscreenElement === box ? (shown = true) : shown && done());
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFull);
  close.addEventListener('click', done);
  pause.addEventListener('click', () => setPaused(!paused));
  next.addEventListener('click', () => show(i + 1, true));
  prev.addEventListener('click', () => show(i - 1, true));
  // Let both layers play with sound later (after loading): start them now, in the tap, muted, then stop.
  for (const v of vids) {
    v.muted = true;
    void v.play()?.catch?.(() => undefined);
    v.pause();
  }
  const rec = opts.record ? recorder() : undefined;
  if (rec) for (const b of [prev, pause, next]) b.hidden = true; // the recording plays straight through
  if (box.requestFullscreen) void box.requestFullscreen().catch(() => undefined);
  // Every clip (and its fixed voices) loaded before the first plays, so nothing stalls mid-scene.
  // Each is held in memory for the preview; one that can't be fetched here plays from its link.
  const loading = new AbortController();
  const blobs: string[] = [];
  void (async () => {
    const urls = [...new Set(items.flatMap((it) => [it.video, ...(it.voices ? [...it.voices.background, ...it.voices.voices.map((x) => x.url), ...(it.voices.vocals ? [it.voices.vocals] : [])] : [])]).filter((u): u is string => !!u))];
    const map = new Map<string, string>();
    if (urls.length) {
      let n = 0;
      const say = () => {
        still.style.transition = 'none';
        still.style.backgroundImage = 'none';
        still.style.opacity = '1';
        still.textContent = `Loading the clips… ${n} of ${urls.length}`;
        cap.textContent = opts.title ?? '';
      };
      say();
      await Promise.all(
        urls.map(async (u) => {
          try {
            const r = await fetch(u, { credentials: 'same-origin', signal: loading.signal });
            if (r.ok) {
              const b = URL.createObjectURL(await r.blob());
              blobs.push(b);
              map.set(u, b);
            }
          } catch {
            /* plays from its link */
          }
          n++;
          if (!loading.signal.aborted) say();
        }),
      );
    }
    if (loading.signal.aborted) return;
    const local = (u: string) => map.get(u) ?? u;
    items = items.map((it) => ({
      ...it,
      ...(it.video ? { video: local(it.video) } : {}),
      ...(it.voices ? { voices: { ...it.voices, background: it.voices.background.map(local), voices: it.voices.voices.map((x) => ({ ...x, url: local(x.url) })), ...(it.voices.vocals ? { vocals: local(it.voices.vocals) } : {}) } } : {}),
    }));
    still.textContent = '';
    rec?.begin();
    show(0, true);
  })();

  /**
   * ⬇ Save video: what plays is drawn onto a canvas (crossfades too) and recorded with the
   * clips' sound, in real time; at the end the file is offered to download or share.
   */
  function recorder() {
    const W = 1280;
    const H = 720;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g2 = canvas.getContext('2d')!;
    const img = new Image();
    let stillItem: SequenceItem | undefined;
    // The clips' sound, mixed: to the recording and still to the speakers.
    const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ac = AC ? new AC() : undefined;
    const dest = ac?.createMediaStreamDestination();
    if (ac && dest)
      for (const v of vids) {
        const src = ac.createMediaElementSource(v);
        src.connect(dest);
        src.connect(ac.destination);
      }
    // H.264 MP4 plays everywhere (iPhones too); else WebM, which browsers and VLC play. A plain
    // "video/mp4" can mean VP9 inside MP4, which iPhones can't play, so it comes last.
    const type =
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) =>
        globalThis.MediaRecorder?.isTypeSupported?.(t),
      ) ?? '';
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...(dest?.stream.getAudioTracks() ?? [])]);
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let keep = true;
    let started = Date.now();
    // Fit a picture into the frame (letterboxed), like the player shows it.
    const fit = (el: CanvasImageSource, w: number, h: number) => {
      if (!w || !h) return;
      const k = Math.min(W / w, H / h);
      g2.drawImage(el, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
    };
    let raf = 0;
    const frame = () => {
      g2.globalAlpha = 1;
      g2.fillStyle = '#000';
      g2.fillRect(0, 0, W, H);
      for (const v of vids) {
        const a = Number(getComputedStyle(v).opacity);
        if (a > 0.01 && v.readyState >= 2) ((g2.globalAlpha = a), fit(v, v.videoWidth, v.videoHeight));
      }
      const a = Number(getComputedStyle(still).opacity);
      if (a > 0.01 && stillItem) {
        g2.globalAlpha = a;
        if (stillItem.image && img.complete && img.naturalWidth) fit(img, img.naturalWidth, img.naturalHeight);
        else {
          g2.fillStyle = '#fff';
          g2.font = '500 40px system-ui, sans-serif';
          g2.textAlign = 'center';
          const lines = String(stillItem.text ?? stillItem.label).split('\n');
          lines.forEach((l, k) => g2.fillText(l, W / 2, H / 2 + (k - (lines.length - 1) / 2) * 52, W - 120));
        }
      }
      cap.textContent = cap.textContent!.replace(/^● Recording( \d+:\d\d)? · /, `● Recording ${elapsed(started)} · `);
      raf = requestAnimationFrame(frame);
    };
    // Recording needs the page in front: if it goes to the background, stop and say so.
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      cancel();
      cap.textContent = 'Recording stopped: keep the screen on and the app in front while it records.';
    };
    document.addEventListener('visibilitychange', onHide);
    const stopAll = () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onHide);
      if (mr.state !== 'inactive') mr.stop();
    };
    function cancel() {
      keep = false;
      stopAll();
      void ac?.close();
    }
    mr.onstop = () => {
      void ac?.close();
      if (!keep) return;
      const blob = new Blob(chunks, { type: (mr.mimeType || type || 'video/webm').split(';')[0] });
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${(opts.title ?? 'preview').replace(/^Preview: /, '').replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'preview'}.${ext}`;
      const url = URL.createObjectURL(blob);
      // The end: the file, to download or share (where the phone can).
      for (const v of vids) v.style.opacity = '0';
      still.style.opacity = '0';
      const end = document.createElement('div');
      end.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff;font:500 16px/1.4 system-ui,sans-serif;text-align:center;padding:24px;';
      const preview = Object.assign(document.createElement('video'), { src: url, controls: true, playsInline: true });
      preview.style.cssText = 'max-width:100%;max-height:55vh;border-radius:8px;background:#111;';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
      const pill = 'padding:10px 18px;border-radius:999px;border:0;font:600 15px system-ui,sans-serif;cursor:pointer;text-decoration:none;';
      const dl = Object.assign(document.createElement('a'), { href: url, download: name, textContent: '⬇ Download' });
      dl.style.cssText = pill + 'background:#fff;color:#111;';
      row.append(dl);
      const file = new File([blob], name, { type: blob.type });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        const sh = Object.assign(document.createElement('button'), { type: 'button', textContent: '↗ Share' });
        sh.style.cssText = pill + 'background:rgba(255,255,255,.18);color:#fff;';
        sh.addEventListener('click', () => void navigator.share({ files: [file], title: name }).catch(() => undefined));
        row.append(sh);
      }
      end.append(Object.assign(document.createElement('div'), { textContent: `${name} · ${(blob.size / 1048576).toFixed(1)} MB` }), preview, row);
      box.append(end);
      cap.textContent = '';
      close.addEventListener('click', () => URL.revokeObjectURL(url));
    };
    return {
      /** Start recording (once every clip has loaded). */
      begin() {
        started = Date.now();
        mr.start(1000);
        raf = requestAnimationFrame(frame);
      },
      /** The still showing now (or none while a clip plays). */
      still(it: SequenceItem | undefined) {
        stillItem = it;
        if (it?.image) img.src = it.image;
      },
      /** The sequence ended: stop recording; the file is offered. */
      finish() {
        clearTimeout(timer);
        stopAll();
        for (const v of vids) v.pause();
      },
      cancel,
      /** Fixed voices play through this, so they're recorded too. */
      audio: ac && dest ? { ac, dest } : undefined,
    };
  }
}

/** Clips a page can read to record (its own site's, or local blobs and data). */
const readable = (u: string) => !/^https?:\/\//i.test(u) || (typeof location !== 'undefined' && u.startsWith(location.origin + '/'));

/** Play a clip full screen, with sound (from a tap, so browsers allow the sound). */
export function playClip(url: string, poster?: string, voices?: VoiceTrack): void {
  const box = document.createElement('div');
  box.className = 'dr-player';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Clip');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;align-items:center;justify-content:center;';
  const v = Object.assign(document.createElement('video'), { src: url, controls: true, autoplay: true, playsInline: true, muted: false });
  if (poster) v.poster = poster;
  v.style.cssText = 'width:100%;height:100%;object-fit:contain;';
  const close = Object.assign(document.createElement('button'), { type: 'button', textContent: '✕' });
  close.setAttribute('aria-label', 'Close the clip');
  close.style.cssText = 'position:absolute;top:max(12px,env(safe-area-inset-top));right:12px;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font:20px system-ui,sans-serif;cursor:pointer;';
  box.append(v, close);
  document.body.append(box);
  // Fixed voices (🎙): they play instead of the clip's own sound.
  const unvoice = voices?.voices.length ? attachVoiceTrack(v, voices) : undefined;
  let shown = false;
  const done = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFull);
    v.pause();
    unvoice?.();
    if (document.fullscreenElement === box) void document.exitFullscreen?.().catch(() => undefined);
    box.remove();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done();
  // Leaving full screen (back gesture, Esc) closes the player too.
  const onFull = () => (document.fullscreenElement === box ? (shown = true) : shown && done());
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFull);
  close.addEventListener('click', done);
  v.addEventListener('ended', done);
  v.addEventListener('webkitendfullscreen', done); // iPhone's own player
  void v.play()?.catch?.(() => undefined);
  // The page's full screen where there is one; iPhones only do it for the video itself.
  const vid = v as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  if (box.requestFullscreen) void box.requestFullscreen().catch(() => vid.webkitEnterFullscreen?.());
  else vid.webkitEnterFullscreen?.();
}

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
  return (await clipFramesOf(file, max)).last;
}

/** A clip's first and last frames (JPEG data URLs) and its length in seconds. */
export async function clipFramesOf(file: Blob, max = 1280): Promise<{ first: string; last: string; seconds: number }> {
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
    const k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const grab = async (t: number) => {
      const seeked = once('seeked');
      v.currentTime = t;
      await seeked;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(v.videoWidth * k));
      c.height = Math.max(1, Math.round(v.videoHeight * k));
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.9);
    };
    const seconds = v.duration;
    // Just after the start (some clips open on a black frame at 0).
    const first = await grab(Math.min(0.05, seconds / 2));
    const last = await grab(Math.max(0, seconds - 0.05));
    return { first, last, seconds };
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
  /** What to look at before generating (thin descriptions, sketches, unpicked views…). */
  checks?: string[];
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
        const f = await clipFramesOf(file);
        keepFrames(f);
        newClip(ctx.graph, ctx.node.id);
        ctx.graph.setParam(ctx.node.id, 'clipFrom', null);
        value = f.last;
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
    /** The clip's first frame (what the shot looks like) and length, kept beside its last frame. */
    const keepFrames = (f: { first: string; seconds: number }) => {
      ctx.graph.setParam(ctx.node.id, 'clipPoster', f.first);
      if (Number.isFinite(f.seconds)) ctx.graph.setParam(ctx.node.id, 'clipSeconds', Math.round(f.seconds * 10) / 10);
    };
    /**
     * On the board, a shot with a clip is its clip: the first frame, its length, a line the
     * param gives (where, who), and ▶ (shown once the card is zoomed into) to play it full screen.
     */
    const drawCard = () => {
      wrap.replaceChildren(input);
      wrap.classList.add('dr-clip-compact');
      const ps = ctx.graph.nodes.get(ctx.node.id)?.params ?? {};
      const url = typeof ps.clipUrl === 'string' ? ps.clipUrl : '';
      const poster = (typeof ps.clipPoster === 'string' && ps.clipPoster) || value;
      const fig = document.createElement('div');
      fig.className = 'dr-clip-card';
      if (poster) fig.append(Object.assign(document.createElement('img'), { src: poster, alt: '' }));
      const secs = Number(ps.clipSeconds);
      if (secs > 0) fig.append(Object.assign(document.createElement('span'), { className: 'dr-clip-len', textContent: `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` }));
      // Being made (a first clip or a newer one): over the picture, clearly, with the service's status and the time.
      const job = jobOf();
      const busy = making ?? liveClips.get(ctx.node.id) ?? (job ? { text: `Generating on ${job.service}…`, since: job.startedAt } : undefined);
      if (busy) {
        fig.classList.add('dr-clip-making');
        fig.append(pendingTile('dr-clip-tile dr-clip-over', busy));
      } else if (url) {
        const fixed = ps.voiceTrack as VoiceTrack | undefined;
        const play = button('▶', 'Play the clip full screen, with sound', () => playClip(url, poster || undefined, fixed), 'dr-clip-play');
        play.dataset.nmLive = ''; // works on a look-only card
        fig.append(play);
      }
      wrap.append(fig);
      const stale = !busy && (ctx.param as { stale?: (node: NodeInstance, graph: Graph) => string | undefined }).stale?.(ctx.node, ctx.graph);
      if (stale) wrap.append(Object.assign(document.createElement('div'), { className: 'dr-clip-stale', textContent: `⚠ ${stale}` }));
      const line = (ctx.param as { summary?: (node: NodeInstance, graph: Graph) => string }).summary?.(ctx.node, ctx.graph);
      if (line) wrap.append(Object.assign(document.createElement('div'), { className: 'dr-clip-sum', textContent: line }));
      wrap.append(status); // what the service said (still generating, failed…)
      // A clip from before first frames were kept: take it now, once per page (only clips this site serves can be read).
      const here = typeof location !== 'undefined' ? location.origin : '';
      if (url && !ps.clipPoster && !posterTried.has(url) && (!/^https?:\/\//i.test(url) || url.startsWith(here))) {
        posterTried.add(url);
        void fetch(url, { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .then((b) => clipFramesOf(b))
          .then((f) => (keepFrames(f), wrap.isConnected && draw()))
          .catch(() => undefined);
      }
    };
    const history = ctx.place === 'sheet' ? generationHistory(ctx.node.id, ctx.param.name) : undefined;
    /** Tell the shot's other views (its card) how the clip this field is making is going. */
    let shared: Pending | undefined;
    const share = () => {
      if (making === shared) return;
      shared = making;
      if (making) liveClips.set(ctx.node.id, making);
      else liveClips.delete(ctx.node.id);
      document.dispatchEvent(new CustomEvent(CLIP_PROGRESS, { detail: ctx.node.id }));
    };
    const draw = () => {
      share();
      const ps = ctx.graph.nodes.get(ctx.node.id)?.params ?? {};
      const compact = (ctx.param as { compact?: boolean }).compact;
      if (ctx.place !== 'sheet' && compact && (value || ps.clipUrl || jobOf() || making || liveClips.has(ctx.node.id))) return drawCard();
      wrap.classList.remove('dr-clip-compact');
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
      } else if (getVideoGenerators().length) {
        // The same button folds its panel away again.
        const b = panel && panelKind === 'gen' ? button('✕ Close', 'Close the clip panel', () => openGen()) : button('🎬 Generate clip', 'Generate a clip for this shot', () => ((panelKind = 'gen'), openGen()));
        b.setAttribute('aria-expanded', String(!!panel && panelKind === 'gen'));
        wrap.append(b);
        // A clip to change (a kept copy or a link), and a service that can.
        const url = ctx.graph.nodes.get(ctx.node.id)?.params.clipUrl;
        if (typeof url === 'string' && url && getVideoGenerators().some((g) => g.edit)) {
          const e = panel && panelKind === 'edit' ? button('✕ Close', 'Close the change panel', () => openEdit()) : button('✏️ Change this clip', 'Change this clip: say what should be different', () => openEdit());
          e.setAttribute('aria-expanded', String(!!panel && panelKind === 'edit'));
          wrap.append(e);
        }
        // 🎙 Fix voices: each speaker in their character's fixed voice (and play it).
        if (typeof url === 'string' && url && getVoiceTools()) {
          const fixed = ctx.graph.nodes.get(ctx.node.id)?.params.voiceTrack as VoiceTrack | undefined;
          const vb = panel && panelKind === 'voices' ? button('✕ Close', 'Close the voices panel', () => openVoices()) : button(fixed?.voices.length ? '🎙 Voices fixed ✓' : '🎙 Fix voices', 'Change each speaker to their character’s fixed voice', () => openVoices());
          vb.setAttribute('aria-expanded', String(!!panel && panelKind === 'voices'));
          wrap.append(vb);
          if (fixed?.voices.length) wrap.append(button('▶ With fixed voices', 'Play the clip with the fixed voices', () => playClip(url, undefined, fixed)));
        }
      }
      wrap.append(status);
      if (panel) wrap.append(panel);
      if (history) wrap.append(history);
    };

    /**
     * ✏️ Change this clip: say what should be different; the service keeps the rest (Kling O3
     * edit takes up to 4 of the shot's pictures). The changed clip becomes the shot's clip; what
     * made each one stays in 🕘 How these were made.
     */
    const openEdit = () => {
      if (panel) {
        const was = panelKind as string;
        abort?.abort();
        panel = undefined;
        if (was === 'edit') return draw();
      }
      panelKind = 'edit';
      const gen = getVideoGenerators().find((g) => g.edit && g.id === chosen?.id) ?? getVideoGenerators().find((g) => g.edit);
      const url = ctx.graph.nodes.get(ctx.node.id)?.params.clipUrl;
      if (!gen?.edit || typeof url !== 'string' || !url) return;
      const ps = ctx.graph.nodes.get(ctx.node.id)!.params;
      const seconds = Number(ps.clipSeconds) || Number(ps.duration) || 5;
      const el = (tag: string, attrs: Record<string, string> = {}, text = '') => {
        const x = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
        if (text) x.textContent = text;
        return x;
      };
      const box = el('div', { class: 'dr-gen-panel dr-clip-panel dr-edit-panel', role: 'group', 'aria-label': `Change this clip with ${gen.name}` });
      const models = gen.editModels ?? [];
      const model = el('select', { 'aria-label': 'Model' }) as HTMLSelectElement;
      for (const m of models) model.append(Object.assign(document.createElement('option'), { value: m.id, textContent: m.label }));
      const hint = el('small', { class: 'dr-gen-refs-note' });
      const say = el('textarea', { rows: '3', 'aria-label': 'What should change', placeholder: 'What should be different? e.g. The stage is empty: no chairs. Everything else stays.' }) as HTMLTextAreaElement;
      const sound = el('label', { class: 'dr-clip-sound' });
      const keep = el('input', { type: 'checkbox', 'aria-label': 'Keep the sound' }) as HTMLInputElement;
      keep.checked = true;
      sound.append(keep, ' keep the sound');
      // The shot's pictures (cast first), to keep faces and costumes right: up to the model's limit.
      let sug: ShotClipSuggestion | undefined;
      try {
        sug = (ctx.param as { video?: (node: NodeInstance, graph: Graph) => ShotClipSuggestion | undefined }).video?.(ctx.node, ctx.graph);
      } catch {
        sug = undefined;
      }
      const pics = (sug?.references ?? []).filter((r) => r.card && !/frame|storyboard/i.test(r.label));
      const on = new Set<string>();
      const strip = el('div', { class: 'dr-gen-refs' });
      const price = el('small', { class: 'dr-gen-cost', role: 'status' });
      const st = el('div', { class: 'dr-gen-status', role: 'status' });
      const current = () => models.find((m) => m.id === model.value) ?? models[0];
      const fit = () => {
        const m = current();
        hint.textContent = m?.hint ?? '';
        const max = m?.maxReferences ?? 0;
        // Too many on for this model: the first ones stay.
        [...on].slice(max).forEach((x) => on.delete(x));
        if (!on.size) pics.slice(0, max).forEach((r) => on.add(r.src));
        strip.hidden = max === 0;
        strip.querySelectorAll<HTMLElement>('.dr-gen-ref').forEach((b) => b.setAttribute('aria-pressed', String(on.has(b.dataset.src!))));
        keep.disabled = !m?.audio;
        const e = gen.editEstimate?.({ model: m?.id, seconds });
        price.textContent = e ? `About ${e.unit === 'USD' ? `$${e.amount.toFixed(2)}` : `${e.amount} credits`} for this ${Math.round(seconds)} s clip (${e.basis})` : '';
        if (m?.minSeconds && seconds < m.minSeconds) price.textContent += ` · this model needs clips of at least ${m.minSeconds} s`;
        if (m?.maxSeconds && seconds > m.maxSeconds) price.textContent += ` · this model takes clips of up to ${m.maxSeconds} s`;
      };
      for (const r of pics) {
        const b = el('button', { type: 'button', class: 'dr-gen-ref', title: r.label, 'aria-label': r.label, 'aria-pressed': 'false' }) as HTMLButtonElement;
        b.dataset.src = r.src;
        b.append(el('img', { src: r.src, alt: '' }), el('span', {}, r.label));
        b.addEventListener('click', () => {
          const max = current()?.maxReferences ?? 0;
          if (on.has(r.src)) on.delete(r.src);
          else if (on.size < max) on.add(r.src);
          else return void (st.textContent = `${current()?.label} takes up to ${max} pictures: switch one off first.`);
          b.setAttribute('aria-pressed', String(on.has(r.src)));
        });
        strip.append(b);
      }
      model.addEventListener('change', fit);
      const go = el('button', { type: 'button', class: 'dr-gen-go' }, `✏️ Change it with ${gen.name}`) as HTMLButtonElement;
      const cancel = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Cancel') as HTMLButtonElement;
      cancel.addEventListener('click', () => openEdit());
      const row = el('div', { class: 'dr-gen-row' });
      row.append(go, cancel);
      go.addEventListener('click', async () => {
        if (gen.key && !gen.key.get()) return void (st.textContent = `Add your ${gen.key.label} first (in 🎬 Generate clip).`);
        const words = say.value.trim();
        if (!words) return void (st.textContent = 'Say what should change first.');
        const m = current();
        st.textContent = '';
        const e = gen.editEstimate?.({ model: m?.id, seconds });
        if (!(await confirmSpend(go, gen.name, Promise.resolve(e && { amount: e.amount, unit: e.unit }), gen.balance?.()))) return;
        const sent = pics.filter((r) => on.has(r.src) && (m?.maxReferences ?? 0) > 0);
        // The model ties pictures to the words by @Image1…, and the clip by @Video1: say which is which.
        const prompt = [
          words,
          ...(m?.id.startsWith('kling') ? [`Change only that in @Video1; keep everything else as it is: the people, their positions, the camera, the timing${keep.checked ? ' and the sound' : ''}.`] : []),
          ...(sent.length ? [`Pictures: ${sent.map((r, i) => `@Image${i + 1} is ${r.label}`).join('; ')}.`] : []),
        ].join('\n');
        abort = new AbortController();
        go.disabled = true;
        making = { text: `Asking ${gen.name}…`, since: Date.now() };
        share();
        draw();
        let logged = false;
        const record = (result?: string[]) => {
          if (logged) return;
          logged = true;
          logGeneration({
            at: Date.now(),
            kind: 'clip',
            node: ctx.node.id,
            param: ctx.param.name,
            service: gen.name,
            model: m?.label,
            prompt,
            references: sent.map((r) => ({ label: r.label, ...(linkOnly(r.src) ? { src: r.src } : {}) })),
            settings: { change: true, from: linkOnly(url), duration: Math.round(seconds), sound: keep.checked && !keep.disabled },
            ...(result ? { result } : {}),
            ...(e ? { cost: `about ${e.unit === 'USD' ? `$${e.amount.toFixed(2)}` : `${e.amount} credits`}` } : {}),
          });
        };
        let submitted = false;
        try {
          const refs = await Promise.all(sent.map((r) => referencePicture(r.src)));
          const result = await gen.edit!({
            video: url,
            prompt,
            references: refs,
            model: m?.id,
            keepAudio: keep.checked && !keep.disabled,
            signal: abort.signal,
            onProgress: (t, pc) => {
              st.textContent = pc != null ? `${t} ${Math.round(pc)}%` : t;
              progress(t, pc);
            },
            onSubmitted: (job) => {
              record();
              submitted = true;
              collecting.add(`${ctx.node.id}:${job.startedAt}`);
              ctx.graph.setParam(ctx.node.id, 'clipJob', job);
            },
          });
          const clip = result.videos[0];
          if (!clip) throw new Error(`${gen.name} returned no clip`);
          record([clip]);
          await collect(clip, result.cost ?? (e ? `about ${e.unit === 'USD' ? `$${e.amount.toFixed(2)}` : `${e.amount} credits`}` : ''), abort.signal);
          panel = undefined;
          draw();
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          if (submitted && (err as { code?: string }).code === 'pending') {
            status.textContent = (err as Error).message;
            panel = undefined;
            return draw();
          }
          if (submitted) ctx.graph.setParam(ctx.node.id, 'clipJob', null);
          st.textContent = (err as Error).message || 'Something went wrong';
          go.disabled = false;
        } finally {
          making = undefined;
          share();
          if (wrap.isConnected) draw();
        }
      });
      box.append(
        el('small', { class: 'dr-gen-refs-note' }, 'Say what should be different; the rest of the clip stays.'),
        say,
        model,
        hint,
        ...(pics.length ? [strip, el('small', { class: 'dr-gen-refs-note' }, 'Pictures to keep faces, costumes and places right (tap to switch).')] : []),
        sound,
        price,
        row,
        st,
      );
      fit();
      panel = box;
      draw();
      if (globalThis.matchMedia?.('(pointer: fine)').matches) say.focus({ preventScroll: true });
    };

    /**
     * 🎙 Fix voices: separate the clip's voices from the rest, find who speaks when, match the
     * speakers to the shot's characters (from the lines quoted in its description; you confirm),
     * then change each to that character's fixed voice. The result plays with the clip.
     */
    const openVoices = () => {
      if (panel) {
        const was = panelKind as string;
        abort?.abort();
        panel = undefined;
        if (was === 'voices') return draw();
      }
      panelKind = 'voices';
      const tools = getVoiceTools();
      const url = ctx.graph.nodes.get(ctx.node.id)?.params.clipUrl;
      if (!tools || typeof url !== 'string' || !url) return;
      const ps = ctx.graph.nodes.get(ctx.node.id)!.params;
      const seconds = Number(ps.clipSeconds) || Number(ps.duration) || 5;
      type Cast = { id: string; name: string; voice: { name?: string; sample?: string } };
      let cast: Cast[] = [];
      try {
        cast = (ctx.param as { cast?: (node: NodeInstance, graph: Graph) => Cast[] }).cast?.(ctx.node, ctx.graph) ?? [];
      } catch {
        cast = [];
      }
      const el = (tag: string, attrs: Record<string, string> = {}, text = '') => {
        const x = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
        if (text) x.textContent = text;
        return x;
      };
      const money = (e?: { amount: number; unit: string }) => (e ? (e.unit === 'USD' ? `$${e.amount.toFixed(2)}` : `${e.amount} credits`) : '');
      const box = el('div', { class: 'dr-gen-panel dr-clip-panel dr-voices-panel', role: 'group', 'aria-label': 'Fix voices' });
      const st = el('div', { class: 'dr-gen-status', role: 'status' });
      const list = el('div', { class: 'dr-voices' });
      const fixed = ps.voiceTrack as VoiceTrack | undefined;
      const intro = el('small', { class: 'dr-gen-refs-note' }, 'Listens to the clip, finds who says what, and changes each speaker to their character’s fixed voice (set on their card), keeping the timing so the lips still match.');
      const listen = el('button', { type: 'button', class: 'dr-gen-go' }, `👂 Listen for who speaks · about ${money(tools.estimate?.(seconds, 0)) || 'a few cents'}`) as HTMLButtonElement;
      const row = el('div', { class: 'dr-gen-row' });
      row.append(listen);
      if (fixed?.voices.length) {
        const remove = el('button', { type: 'button', class: 'dr-gen-cancel' }, 'Remove the fixed voices') as HTMLButtonElement;
        remove.addEventListener('click', () => {
          ctx.graph.setParam(ctx.node.id, 'voiceTrack', null);
          panel = undefined;
          draw();
        });
        row.append(remove);
      }
      let parts: { vocals: string; background: string[] } | undefined;
      let speakers: Speaker[] = [];
      const picks: Record<string, string> = {};
      const when = (segs: [number, number][]) => segs.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(', ');
      const voiceOf = (id: string) => cast.find((c) => c.id === id)?.voice ?? {};
      const voiceLabel = (id: string) => {
        const v = voiceOf(id);
        return v.sample ? 'their own recording' : v.name ? `${v.name} (fixed voice)` : '';
      };
      const go = el('button', { type: 'button', class: 'dr-gen-go' }, '🎙 Change the voices') as HTMLButtonElement;
      const showSpeakers = () => {
        list.replaceChildren();
        for (const sp of speakers) {
          const item = el('div', { class: 'dr-voice' });
          const sel = el('select', { 'aria-label': `Who is ${sp.id}` }) as HTMLSelectElement;
          sel.append(Object.assign(document.createElement('option'), { value: '', textContent: 'Leave as it is' }));
          for (const c of cast) sel.append(Object.assign(document.createElement('option'), { value: c.id, textContent: c.name }));
          sel.value = picks[sp.id] ?? '';
          const note = el('small', {});
          const say = () => {
            const id = sel.value;
            note.textContent = !id ? 'Stays as generated.' : voiceLabel(id) ? `→ ${voiceLabel(id)}` : `${cast.find((c) => c.id === id)?.name} has no fixed voice: set one on their card first.`;
            note.className = id && !voiceLabel(id) ? 'dr-voice-warn' : '';
          };
          sel.addEventListener('change', () => ((picks[sp.id] = sel.value), say(), fit()));
          say();
          item.append(el('div', { class: 'dr-voice-text' }, `“${sp.text}”`), el('small', {}, `${sp.id.replace(/_/g, ' ')} · ${when(sp.segments)}`), sel, note);
          list.append(item);
        }
        fit();
      };
      const fit = () => {
        const n = speakers.filter((sp) => picks[sp.id] && voiceLabel(picks[sp.id])).length;
        go.disabled = !n;
        go.textContent = n ? `🎙 Change ${n} voice${n > 1 ? 's' : ''} · about ${money(tools.estimate?.(seconds, n)) || '?'}` : '🎙 Change the voices';
      };
      listen.addEventListener('click', async () => {
        if (tools.key && !tools.key.get()) return void (st.textContent = `Add your ${tools.key.label} first (in 🎬 Generate clip).`);
        abort = new AbortController();
        listen.disabled = true;
        try {
          parts = await tools.separate(url, { signal: abort.signal, onProgress: (t) => (st.textContent = t) });
          const words = await tools.transcribe(parts.vocals, { signal: abort.signal, onProgress: (t) => (st.textContent = t) });
          speakers = speakersOf(words);
          if (!speakers.length) {
            st.textContent = 'No one speaks in this clip.';
            return;
          }
          const lines = quotedLines(String(ps.description ?? ''), cast);
          Object.assign(picks, matchSpeakers(speakers, lines, cast.map((c) => c.id)));
          st.textContent = `${speakers.length} speaker${speakers.length > 1 ? 's' : ''}. Check who is who, then change the voices.`;
          showSpeakers();
          row.replaceChildren(go);
        } catch (err) {
          if ((err as Error).name !== 'AbortError') st.textContent = (err as Error).message || 'Something went wrong';
          listen.disabled = false;
        }
      });
      go.addEventListener('click', async () => {
        if (!parts) return;
        const todo = speakers.filter((sp) => picks[sp.id] && voiceLabel(picks[sp.id]));
        const e = tools.estimate?.(seconds, todo.length);
        if (!(await confirmSpend(go, tools.name, Promise.resolve(e && { amount: e.amount, unit: e.unit }), undefined))) return;
        abort = new AbortController();
        go.disabled = true;
        making = { text: 'Changing the voices…', since: Date.now() };
        share();
        draw();
        try {
          // One change per character (a character heard as two speakers is changed once).
          const byChar = new Map<string, [number, number][]>();
          for (const sp of todo) byChar.set(picks[sp.id], [...(byChar.get(picks[sp.id]) ?? []), ...sp.segments]);
          const changed = await Promise.all(
            [...byChar].map(async ([character, segments]) => ({ character, segments, url: await tools.convert(parts!.vocals, voiceOf(character), { signal: abort!.signal, onProgress: (t) => (st.textContent = t) }) })),
          );
          // Kept where the host keeps clips (service links expire).
          const keepOne = async (u: string) => (clipKeeper ? await clipKeeper(u, { shotId: ctx.node.id }).catch(() => u) : u);
          const kept = (s2: string) => keepOne(s2);
          const left = speakers.filter((sp) => !todo.includes(sp)).flatMap((sp) => sp.segments);
          const track: VoiceTrack = {
            at: Date.now(),
            background: await Promise.all(parts.background.map(kept)),
            voices: await Promise.all(changed.map(async (c) => ({ ...c, url: await kept(c.url) }))),
            ...(left.length ? { vocals: await kept(parts.vocals), kept: left } : {}),
          };
          ctx.graph.setParam(ctx.node.id, 'voiceTrack', track);
          logGeneration({
            at: Date.now(),
            kind: 'voices',
            node: ctx.node.id,
            param: ctx.param.name,
            service: tools.name,
            prompt: todo.map((sp) => `“${sp.text}” → ${cast.find((c) => c.id === picks[sp.id])?.name} (${voiceLabel(picks[sp.id])})`).join('\n'),
            references: [],
            settings: { from: linkOnly(url), voices: byChar.size },
            result: track.voices.map((v) => v.url),
            ...(e ? { cost: `about ${money(e)}` } : {}),
          });
          status.textContent = 'Voices fixed: ▶ plays them (the scene preview and saved videos too).';
          panel = undefined;
        } catch (err) {
          if ((err as Error).name !== 'AbortError') st.textContent = (err as Error).message || 'Something went wrong';
          go.disabled = false;
        } finally {
          making = undefined;
          share();
          if (wrap.isConnected) draw();
        }
      });
      const missing = cast.filter((c) => !c.voice.name && !c.voice.sample).map((c) => c.name);
      box.append(
        intro,
        ...(missing.length ? [el('small', { class: 'dr-voice-warn' }, `No fixed voice yet for ${missing.join(', ')}: set one on their card (✎ Edit → fixed voice, or their own recording).`)] : []),
        list,
        row,
        st,
      );
      panel = box;
      draw();
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
          keepTried.add(kept); // the copy is kept already
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
        }
      }
      // The clip first, then forget the job: the shot is never without either (its card shows the field while it has one).
      ctx.graph.setParam(ctx.node.id, 'clipUrl', kept);
      ctx.graph.setParam(ctx.node.id, 'clipJob', null);
      newClip(ctx.graph, ctx.node.id);
      draw();
      try {
        posterTried.add(kept);
        const f = await clipFramesOf(await (await fetch(kept, { signal, credentials: 'same-origin' })).blob());
        keepFrames(f);
        value = f.last;
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
      share();
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
        share();
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
    /** Which panel is open: 🎬 a new clip, or ✏️ a change to this one. */
    let panelKind: 'gen' | 'edit' | 'voices' = 'gen';
    /** The clip being made, shown as a placeholder in the field. */
    let making: Pending | undefined;
    const progress = (text: string, percent?: number) => {
      if (!making) return;
      making = { ...making, text, percent: percent ?? making.percent };
      share();
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
        const was = panelKind;
        abort?.abort();
        panel = undefined;
        if (was === 'gen') return draw();
        panelKind = 'gen';
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
      // Read it as a page (sections, pictures for @ImageN, checks first); ✎ Edit text for the words.
      const reviewWrap = el('div', { class: 'dr-review-wrap' });
      const showReview = () => {
        const sent = (s?.references ?? []).filter((r) => on.has(r.src));
        reviewWrap.replaceChildren(promptReview(prompt.value, sent, s?.checks ?? []));
      };
      const textBtn = el('button', { type: 'button', class: 'dr-review-toggle' }, '✎ Edit the prompt as text') as HTMLButtonElement;
      prompt.hidden = true;
      textBtn.addEventListener('click', () => {
        prompt.hidden = !prompt.hidden;
        reviewWrap.hidden = !prompt.hidden;
        textBtn.textContent = prompt.hidden ? '✎ Edit the prompt as text' : '☰ Back to the review';
        if (prompt.hidden) showReview();
      });
      box.append(reviewWrap, prompt, textBtn);
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
        // Switching pictures on or off renumbers them: the review follows.
        strip.addEventListener('click', () => queueMicrotask(() => !reviewWrap.hidden && showReview()));
      }
      showReview();
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
        st.textContent = '';
        const q = quote();
        if (!(await confirmSpend(go, gen.name, Promise.resolve(q && { amount: q.amount, unit: q.unit }), gen.balance?.()))) return;
        abort = new AbortController();
        go.disabled = true;
        st.textContent = `Asking ${gen.name}…`;
        let submitted = false;
        let jobKey = '';
        making = { text: `Asking ${gen.name}…`, since: Date.now() };
        share();
        draw();
        try {
          // Pictures the service can read: drawings (SVG) and oversized pictures become JPEGs, as in ✨.
          st.textContent = 'Preparing pictures…';
          const ready = (src: string) =>
            referencePicture(src).catch((err) => {
              throw new Error(`A reference picture couldn’t be prepared (${(err as Error).message}). Switch it off and try again.`);
            });
          const sentRefs = refs.filter((r) => on.has(r.src));
          const picked = await Promise.all(sentRefs.map((r) => ready(r.src)));
          let logged = false;
          const record = (result?: string[]) => {
            if (logged) return;
            logged = true;
            const q = quote();
            logGeneration({
              at: Date.now(),
              kind: 'clip',
              node: ctx.node.id,
              param: ctx.param.name,
              service: gen.name,
              model: gen.models.find((x) => x.id === model.value)?.label ?? model.value,
              prompt: prompt.value.trim(),
              references: sentRefs.map((r) => ({ label: r.label, ...(linkOnly(r.src) ? { src: r.src } : {}) })),
              settings: { duration: Number(dur.value), aspect: aspect.value, resolution: res.value, sound: audio.checked && !audio.disabled },
              ...(result ? { result } : {}),
              ...(q ? { cost: `about ${money(q)}` } : {}),
            });
          };
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
              record(); // accepted: what made it is kept, even if this page can't wait for it
              submitted = true;
              collecting.add(`${ctx.node.id}:${job.startedAt}`);
              ctx.graph.setParam(ctx.node.id, 'clipJob', job);
              // Which clip of the shot before it starts from (to tell when that one changes).
              ctx.graph.setParam(ctx.node.id, 'clipFrom', first ? ((p as { from?: (n: NodeInstance, g: Graph) => number | undefined }).from?.(ctx.node, ctx.graph) ?? null) : null);
              jobKey = `${ctx.node.id}:${job.startedAt}`;
            },
          });
          const clip = result.videos[0];
          if (!clip) throw new Error(`${gen.name} returned no clip`);
          record([clip]);
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
          share();
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
    // A card's 🎬 Clip button opens this field in a sheet, with its panel open.
    wrap.addEventListener(GENERATE_EVENT, () => !panel && !jobOf() && ((panelKind = 'gen'), openGen()));
    wrap.addEventListener(EDIT_EVENT, () => !panel && !jobOf() && openEdit());
    // On the board the field shows more of the shot than its last frame (a job, the first frame,
    // the length): follow every change to the shot.
    if (ctx.place !== 'sheet') {
      const off = ctx.graph.on('change', (c) => {
        if (!wrap.isConnected) return queueMicrotask(off);
        if (c.kind !== 'node:params') return;
        // Its own changes; and another shot's new clip (this one may now be out of date), or the scene's order.
        if (c.node.id === ctx.node.id || (ctx.node.params.continues && (c.name === 'clipAt' || c.name === 'shots'))) draw();
      });
      // …and the progress of a clip being made for it elsewhere on the page (its Edit sheet).
      const onProgress = (e: Event) => {
        if (!wrap.isConnected) return document.removeEventListener(CLIP_PROGRESS, onProgress);
        if ((e as CustomEvent).detail === ctx.node.id && !making) draw();
      };
      document.addEventListener(CLIP_PROGRESS, onProgress);
    }
    draw();
    return wrap;
  },
  update(el, v) {
    (el as HTMLElement & { setClip?: (v: unknown) => void }).setClip?.(v);
  },
};

/**
 * Name and describe a card's pictures as views ("from the wings": what it shows), for the
 * prompts and the ⇄ picker. One row per picture, in the pictures' order.
 */
export const viewsParam: ParamKind = {
  kind: 'views',
  render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'dr-views';
    const of = (ctx.param as { of?: string }).of ?? 'images';
    const read = (): PictureView[] => {
      const v = ctx.graph.nodes.get(ctx.node.id)?.params.views;
      return Array.isArray(v) ? (v as PictureView[]) : [];
    };
    const save = (src: string, patch: Partial<PictureView>) => {
      const pics = imageList(ctx.graph.nodes.get(ctx.node.id)?.params[of]);
      const all = read().filter((x) => x && pics.includes(x.src));
      const i = all.findIndex((x) => x.src === src);
      const next = { ...(i >= 0 ? all[i] : { src }), ...patch };
      if (i >= 0) all[i] = next;
      else all.push(next);
      ctx.set(all.filter((x) => x.name?.trim() || x.description?.trim()));
    };
    const draw = () => {
      const pics = imageList(ctx.graph.nodes.get(ctx.node.id)?.params[of]);
      const views = read();
      wrap.replaceChildren();
      if (!pics.length) return void wrap.append(Object.assign(document.createElement('small'), { className: 'dr-views-empty', textContent: 'Add pictures first; then name each view (e.g. from the wings).' }));
      pics.forEach((src, i) => {
        const v = views.find((x) => x?.src === src);
        const row = document.createElement('div');
        row.className = 'dr-view';
        const img = Object.assign(document.createElement('img'), { src, alt: '' });
        const name = Object.assign(document.createElement('input'), { type: 'text', value: v?.name ?? '', placeholder: i ? 'e.g. from the wings' : 'e.g. from the audience' });
        name.setAttribute('aria-label', `Picture ${i + 1}: view name`);
        name.dataset.key = `${ctx.key}:n:${i}`;
        const desc = Object.assign(document.createElement('textarea'), { rows: 2, value: v?.description ?? '', placeholder: 'What it shows (optional), e.g. black curtain in the foreground, the seats beyond' });
        desc.setAttribute('aria-label', `Picture ${i + 1}: what the view shows`);
        desc.dataset.key = `${ctx.key}:d:${i}`;
        name.addEventListener('change', () => save(src, { name: name.value }));
        desc.addEventListener('change', () => save(src, { description: desc.value }));
        const text = document.createElement('div');
        text.append(name, desc);
        row.append(img, text);
        wrap.append(row);
      });
    };
    // New or removed pictures: new rows (not while typing in one).
    const off = ctx.graph.on('change', (c) => {
      if (!wrap.isConnected) return queueMicrotask(off);
      if (c.kind === 'node:params' && c.node.id === ctx.node.id && !wrap.contains(document.activeElement)) draw();
    });
    draw();
    return wrap;
  },
};

/** ElevenLabs' ready-made voices (fal's voice changer): what a character can be changed to. */
export const VOICE_NAMES = ['Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill'];

/**
 * A short voice recording (the actor reading a few lines): picked from the phone's files, played
 * back here, kept with the card (up to 2 MB). 🎙 Fix voices can match a character's lines to it.
 */
/** Samples already made, by voice and line (each costs a fraction of a cent; made once a visit). */
const voiceSamples = new Map<string, Promise<string>>();
/** A sample line in a ready-made voice (made once, then replayed). */
export function voiceSample(voice: string, line: string): Promise<string> {
  const tools = getVoiceTools();
  if (!tools?.speak) return Promise.reject(new Error('Hearing voices needs a fal key (account menu → AI service keys…)'));
  const k = `${voice}\n${line}`;
  let p = voiceSamples.get(k);
  if (!p) {
    p = tools.speak(line, voice);
    voiceSamples.set(k, p);
    p.catch(() => voiceSamples.delete(k));
  }
  return p;
}

/**
 * A character's fixed voice: one of the ready-made voices, played (a line in their name) as soon
 * as it's picked, and again with ▶.
 */
export const voicePickParam: ParamKind = {
  kind: 'voice-pick',
  render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'dr-audio';
    const sel = document.createElement('select');
    sel.dataset.key = ctx.key;
    for (const v of ['', ...VOICE_NAMES]) sel.append(Object.assign(document.createElement('option'), { value: v, textContent: v || '— none —' }));
    sel.value = typeof ctx.value === 'string' ? ctx.value : '';
    const hear = Object.assign(document.createElement('button'), { type: 'button', className: 'dr-clip-btn', textContent: '▶ Hear' });
    hear.setAttribute('aria-label', 'Hear this voice');
    const note = document.createElement('small');
    const player = Object.assign(document.createElement('audio'), { hidden: true });
    const line = () => `Hi, I'm ${ctx.node.label || 'here'}. This is how I'll sound in every scene.`;
    const play = async () => {
      const voice = sel.value;
      if (!voice) return;
      // Started inside the tap, so the phone lets it play once the sample arrives.
      void player.play().catch(() => undefined);
      hear.disabled = true;
      note.textContent = `Making a sample of ${voice}…`;
      try {
        const url = await voiceSample(voice, line());
        if (sel.value !== voice) return;
        player.src = url;
        await player.play();
        note.textContent = '';
      } catch (e) {
        note.textContent = (e as Error).name === 'NotAllowedError' ? 'Tap ▶ Hear to play it.' : (e as Error).message;
      } finally {
        hear.disabled = !sel.value;
      }
    };
    const sync = () => {
      hear.disabled = !sel.value;
      hear.hidden = !getVoiceTools()?.speak;
    };
    sel.addEventListener('change', () => {
      ctx.set(sel.value);
      player.pause();
      sync();
      void play();
    });
    hear.addEventListener('click', () => void play());
    sync();
    wrap.append(sel, hear, note, player);
    (wrap as HTMLElement & { setVoice?: (v: unknown) => void }).setVoice = (v) => {
      const next = typeof v === 'string' ? v : '';
      if (document.activeElement !== sel && next !== sel.value) ((sel.value = next), sync());
    };
    return wrap;
  },
  update(el, v) {
    (el as HTMLElement & { setVoice?: (v: unknown) => void }).setVoice?.(v);
  },
};

export const audioParam: ParamKind = {
  kind: 'audio',
  render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'dr-audio';
    let value = typeof ctx.value === 'string' ? ctx.value : '';
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*,video/*', hidden: true });
    const note = document.createElement('small');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return void (note.textContent = 'That recording is over 2 MB: 10–20 seconds is plenty.');
      value = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      ctx.set(value);
      draw();
    });
    const draw = () => {
      wrap.replaceChildren(input);
      const add = Object.assign(document.createElement('button'), { type: 'button', className: 'dr-clip-btn', textContent: value ? 'Replace recording…' : '🎤 Add a recording…' });
      add.addEventListener('click', () => input.click());
      if (value) {
        const player = Object.assign(document.createElement('audio'), { src: value, controls: true });
        player.dataset.nmLive = '';
        const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'dr-clip-btn', textContent: '×' });
        rm.setAttribute('aria-label', 'Remove the recording');
        rm.addEventListener('click', () => ((value = ''), ctx.set(''), draw()));
        wrap.append(player, add, rm);
      } else wrap.append(add);
      wrap.append(note);
    };
    (wrap as HTMLElement & { setAudio?: (v: unknown) => void }).setAudio = (v) => {
      const next = typeof v === 'string' ? v : '';
      if (next !== value) ((value = next), draw());
    };
    draw();
    return wrap;
  },
  update(el, v) {
    (el as HTMLElement & { setAudio?: (v: unknown) => void }).setAudio?.(v);
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
      prompt?: (node: NodeInstance, graph: Graph) => { prompt: string; aspect?: string; references?: { src: string; label: string }[]; checks?: string[] } | undefined;
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
    /** ✨ says whether it opens or closes the panel. */
    const syncGen = () =>
      wrap.querySelectorAll<HTMLButtonElement>('.dr-gen:not(.dr-browse)').forEach((g) => {
        g.textContent = panel ? '✕' : '✨';
        g.setAttribute('aria-expanded', String(!!panel));
      });
    const closePanel = () => {
      panel?.remove();
      panel = undefined;
      syncGen();
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
      const prompt = el('textarea', { rows: '8', 'aria-label': 'Image prompt', placeholder: 'Describe the picture' }) as HTMLTextAreaElement;
      prompt.value = suggestion?.prompt ?? '';
      // Read it as a page (the pictures sent, its parts under headings, checks first); ✎ for the words.
      const reviewWrap = el('div', { class: 'dr-review-wrap' });
      let showReview = () => {};
      const textBtn = el('button', { type: 'button', class: 'dr-review-toggle' }, '✎ Edit the prompt as text') as HTMLButtonElement;
      prompt.hidden = true;
      textBtn.addEventListener('click', () => {
        prompt.hidden = !prompt.hidden;
        reviewWrap.hidden = !prompt.hidden;
        textBtn.textContent = prompt.hidden ? '✎ Edit the prompt as text' : '☰ Back to the review';
        if (prompt.hidden) showReview();
      });
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
            bal != null ? `${amountText(bal, est?.unit ?? 'credits')} left` : '',
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
        share(); // the card stops showing it, even if this sheet has closed
        closePanel();
        draw();
      });
      go.addEventListener('click', async () => {
        if (gen.key && keyInput.value.trim()) gen.key.set(cleanKey(keyInput.value));
        if (gen.key && !gen.key.get()) return void (status.textContent = `Add your ${gen.key.label} first.`);
        if (!prompt.value.trim()) return void (status.textContent = 'Write a prompt first.');
        status.textContent = '';
        const m = gen.models?.length ? model.value : undefined;
        const est = gen.estimate?.({ model: m, references: chosen.size }).then((e) => e && { amount: e.credits, unit: e.unit ?? 'credits' });
        if (!(await confirmSpend(go, gen.name, est ?? Promise.resolve(undefined), gen.balance?.()))) return;
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
          const legend = picked.length ? `\nReference pictures (in order): ${picked.map((r, i) => `${i + 1}. ${r.label}`).join('; ')}. Keep the people, costumes, places and objects looking as they do in them.` : '';
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
          logGeneration({
            at: Date.now(),
            kind: 'image',
            node: ctx.node.id,
            param: ctx.param.name,
            service: gen.name,
            model: gen.models?.find((x) => x.id === model.value)?.label ?? (gen.models?.length ? model.value : undefined),
            prompt: prompt.value.trim() + legend,
            references: picked.map((r) => ({ label: r.label, ...(linkOnly(r.src) ? { src: r.src } : {}) })),
            settings: { aspect: aspect.value },
            result: added.map(linkOnly).filter((x): x is string => !!x),
            ...(result.credits != null ? { cost: `${result.credits} credits` } : {}),
          });
          note = `Added ${added.length} from ${gen.name}${result.credits != null ? ` · ${result.credits} credits` : ''}${result.balance != null ? ` · ${result.balance.toLocaleString()} left` : ''}${kept < added.length ? ' · linked, not copied: the link expires' : ''}`;
          making = undefined;
          share(); // the card stops showing it, even if this sheet has closed
          closePanel();
          commit([...list, ...added]);
        } catch (err) {
          making = undefined;
          share(); // the card stops showing it, even if this sheet has closed
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
      showReview = () => {
        const sent = (refChoices as Reference[]).filter((r) => chosen.has(r.src));
        reviewWrap.replaceChildren(promptReview(prompt.value, [], suggestion?.checks ?? [], { first: 'Picture', pictures: sent }));
      };
      showReview();
      // Switching pictures on or off (or ⇄ another): the review follows.
      refs.addEventListener('click', () => setTimeout(() => !reviewWrap.hidden && showReview(), 0));
      panel.append(reviewWrap, prompt, textBtn, row, ...(refChoices.length ? [refs, refNote] : []), cost, keyRow, buttons, status);
      void showCost();
      wrap.append(panel);
      syncGen();
      // Not on touch screens: focusing would pop up the keyboard over the panel.
      if (globalThis.matchMedia?.('(pointer: fine)').matches) prompt.focus({ preventScroll: true });
    };
    // A card's ✨ Picture button opens this field in a sheet, with its panel open.
    wrap.addEventListener(GENERATE_EVENT, () => !panel && openPanel());
    const history = ctx.place === 'sheet' ? generationHistory(ctx.node.id, ctx.param.name) : undefined;
    /** Tell the node's other views (its card, when this is a sheet) how the picture is going. */
    const liveKey = `${ctx.node.id}:${ctx.param.name}`;
    let shared: Pending | undefined;
    let sending = false;
    const share = () => {
      if (making === shared) return;
      shared = making;
      if (making) liveImages.set(liveKey, making);
      else liveImages.delete(liveKey);
      sending = true; // not to itself
      try {
        document.dispatchEvent(new CustomEvent(IMAGE_PROGRESS, { detail: liveKey }));
      } finally {
        sending = false;
      }
    };
    if (ctx.place !== 'sheet') {
      const onProgress = (e: Event) => {
        if (!wrap.isConnected) return document.removeEventListener(IMAGE_PROGRESS, onProgress);
        if ((e as CustomEvent).detail === liveKey && !making && !sending) draw();
      };
      document.addEventListener(IMAGE_PROGRESS, onProgress);
    }
    const draw = () => {
      share();
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
      // Being made: here, or (on the card) from the sheet that's making it.
      const busy = making ?? (ctx.place !== 'sheet' ? liveImages.get(liveKey) : undefined);
      if (busy) wrap.append(pendingTile('dr-thumb dr-making', busy));
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
      // In the sheet: how its pictures were made (the last 7 days); made once, so it stays open.
      if (history) wrap.append(history);
      // On the board, a field can offer its own ✨ (e.g. ✨ Frame beside a shot's frames): it opens
      // the field in a sheet with the generate panel, like the cards' ✨ / 🎬 buttons.
      const cardLabel = (p as { cardGenerate?: string }).cardGenerate;
      if (gen && cardLabel && ctx.place !== 'sheet' && list.length < max) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'dr-gen-card';
        c.dataset.nmLive = ''; // works on a look-only card
        c.textContent = cardLabel;
        c.setAttribute('aria-label', `${cardLabel}: generate with ${gen.name}`);
        c.addEventListener('click', (e) => {
          e.stopPropagation();
          wrap.dispatchEvent(new CustomEvent(NM_OPEN_FIELD, { bubbles: true, detail: { node: ctx.node.id, param: ctx.param.name, title: cardLabel, event: GENERATE_EVENT } }));
        });
        wrap.append(c);
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
      syncGen();
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
export const into = (graph: Graph, id: string) =>
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
  if (!base) return undefined;
  const references = dramaImageReferences(graph, n);
  return { ...base, references, checks: pictureChecks(graph, n, references) };
}

/** What a person should look at before making a picture for a card (thin words, sketches, unpicked views). */
function pictureChecks(graph: Graph, n: NodeInstance, refs: Reference[]): string[] {
  const out: string[] = [];
  const len = (v: unknown) => String(v ?? '').trim().length;
  const name = dramaName(n);
  const noLook = (c: NodeInstance) => !len(c.params.appearance) && out.push(`${dramaName(c)} has no appearance written: it goes into every picture and clip of them.`);
  if (n.type === T.character) noLook(n);
  else if (n.type === T.location && len(n.params.description) < 40) out.push(`${name}’s description is short: say what it looks like (layout, materials, light).`);
  else if ((n.type === T.prop || n.type === T.costume) && len(n.params.description) < 20) out.push(`${name} has little description: say what it’s made of, its colour and details.`);
  else if (n.type === T.shot) {
    const s = shotInfo(graph, n);
    const desc = String(n.params.description ?? '').trim();
    if (desc.length < 60) out.push(desc ? `The shot only says “${desc}”: add where people are, what they do and how it looks.` : 'The shot has no description.');
    if (!s.location) out.push('No location: add one in the shot’s Edit sheet.');
    else {
      const r = referenceImages(s.location, n);
      const real = r.all.filter((x) => !isSketch(x));
      if (real.length > 1 && !r.explicit) out.push(`${dramaName(s.location)} has ${real.length} pictures and none is picked for this shot: ⇄ the view it needs.`);
    }
    s.characters.forEach(noLook);
  } else if (n.type === T.scene && len(n.params.description) < 40) out.push('The scene’s description is short.');
  refs.forEach((r, i) => isSketch(r.src) && out.push(`Picture ${i + 1} (${r.label}) is a placeholder sketch.`));
  return out;
}

/** A suggested picture to generate from, and the reference pictures to send with it. */
export interface DramaImagePrompt {
  prompt: string;
  aspect: string;
  /** Pictures of what is in it (most important first): who is on screen, where, what they wear and hold. */
  references: Reference[];
  /** What to look at before generating. */
  checks?: string[];
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
/** A named view of one of a card's pictures (a location seen "from the wings"), from its `views`. */
export interface PictureView {
  src: string;
  name?: string;
  description?: string;
}
/** The view a card's picture shows, when it has been named or described. */
export function pictureView(card: NodeInstance | undefined, src: string | undefined): PictureView | undefined {
  if (!card || !src || !Array.isArray(card.params.views)) return undefined;
  const v = (card.params.views as PictureView[]).find((x) => x && x.src === src);
  return v && (v.name?.trim() || v.description?.trim()) ? { src, name: v.name?.trim() || undefined, description: v.description?.trim() || undefined } : undefined;
}
/** "View: from the wings — black curtain in the foreground." for a prompt, or ''. */
export function viewSentence(v: PictureView | undefined): string {
  if (!v) return '';
  const d = v.description ? v.description.replace(/[.!?]\s*$/, '') : '';
  return `View: ${[v.name, d].filter(Boolean).join(' — ')}.`;
}

export function referenceImages(card: NodeInstance, target?: NodeInstance): { picked: string | undefined; all: string[]; explicit: boolean } {
  const all = imageList(card.params.images);
  const picks = target?.params.referencePicks as Record<string, string> | undefined;
  const p = picks?.[cardId(card.id)];
  const explicit = !!p && all.includes(p);
  // Unpicked: the first real picture leads (a placeholder sketch only when there's nothing else).
  return { picked: explicit ? p : all.find((x) => !isSketch(x)) ?? all[0], all, explicit };
}

/** A drawn placeholder (the examples' SVG sketches), not a picture of the real thing. */
export const isSketch = (src: string) => /^data:image\/svg/i.test(src);

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
    const v = pictureView(node, r.picked);
    // A named view says which way it looks: "School hall (location, from the wings)".
    const named = v?.name ? label.replace(/\)$/, `, ${v.name})`).replace(/^([^(]*)$/, `$1 (${v.name})`) : label;
    if (r.picked && !out.some((x) => x.src === r.picked)) out.push({ src: r.picked, label: named, card: cardId(node.id), ...(r.all.length > 1 ? { choices: r.all } : {}) });
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
  /** One labelled line per part (easier to read and review), blank parts left out. */
  const lines = (...parts: (string | false | undefined)[]) =>
    parts
      .filter((x): x is string => !!x && !!x.replace(/^[A-Za-z ]+:\s*$/, '').trim())
      .map((x) => x.replace(/[ \t]+/g, ' ').trim())
      .join('\n');
  const sceneOfShot = (id: string) => into(graph, id).find((x) => x.type === T.scene);
  const styleFor = (sceneNode?: NodeInstance) => {
    const ep = sceneNode && into(graph, sceneNode.id).find((x) => x.type === T.episode);
    const season = ep && into(graph, ep.id).find((x) => x.type === T.season);
    return t(ep?.params.style) || t(season?.params.style) || 'Cinematic live-action drama, natural light';
  };
  switch (n.type) {
    case T.character:
      return {
        prompt: lines(
          `Character reference portrait of ${name}.`,
          `Appearance: ${end(t(n.params.appearance))}`,
          `About: ${end(t(n.params.description))}`,
          'Framing: Head to mid-thigh, facing the camera, neutral grey studio background, soft even light, photorealistic.',
          'Rules: No text.',
        ),
        aspect: '3:4',
      };
    case T.location:
      return {
        prompt: lines(
          `Establishing reference photo of ${name}, ${n.params.setting === 'EXT' ? 'exterior' : 'interior'}.`,
          `Description: ${end(t(n.params.description))}`,
          'Framing: Wide shot, no people, natural light, photorealistic.',
          'Rules: No text.',
        ),
        aspect: '16:9',
      };
    case T.prop:
      // The object on its own: no hands or people, so it can be put in anyone's hands later.
      return {
        prompt: lines(
          `Product-style reference photo of ${name}, the object on its own.`,
          `Description: ${end(t(n.params.description))}`,
          'Framing: Plain light background, soft light, photorealistic.',
          'Rules: No people, no hands, no text.',
        ),
        aspect: '1:1',
      };
    case T.costume: {
      const wearer = from(graph, n.id, 'character')[0];
      return {
        // On a headless dress form, never a person: a face here would fight the actor's own
        // portrait when both are sent as references for a shot.
        prompt: lines(
          `Costume reference: ${end(t(n.params.description) || name)}`,
          wearer && `Made for: ${dramaName(wearer)}.`,
          'Framing: The full outfit displayed on a headless dress form (mannequin), front view, plain neutral background, soft even light, photorealistic.',
          'Rules: No person, no face, no text.',
        ),
        aspect: '3:4',
      };
    }
    case T.shot: {
      const s = shotInfo(graph, n);
      const sc = sceneOfShot(n.id);
      const time = sc ? String(sc.params.time ?? 'DAY').toLowerCase() : 'day';
      const view = s.location ? viewSentence(pictureView(s.location, referenceImages(s.location, n).picked)) : '';
      const where = s.location ? `Setting: ${dramaName(s.location)}, ${s.location.params.setting === 'EXT' ? 'exterior' : 'interior'}, ${time}. ${end(t(s.location.params.description))}` : '';
      const costumes = shotCostumes(graph, n.id);
      return {
        prompt: lines(
          `Storyboard frame, ${s.framing.toLowerCase()} shot.${n.params.continues ? ' It carries straight on from the previous shot, without a cut.' : ''}`,
          `Action: ${end(s.description)}`,
          s.characters.length > 0 && ['On screen:', ...s.characters.map((c) => `- ${end(who(c, costumes))}`)].join('\n'),
          where,
          view,
          `Style: ${end(styleFor(sc))}`,
          'Rules: Single film still, no text, no captions.',
        ),
        aspect: '16:9',
      };
    }
    case T.scene: {
      const info = sceneInfo(graph, n);
      const costumes = sceneCostumes(graph, n.id);
      return {
        prompt: lines(
          `Storyboard frame for a scene set in ${info.slug}.`,
          `Action: ${end(info.description)}`,
          info.characters.length > 0 && ['Characters:', ...info.characters.map((c) => `- ${end(who(c, costumes))}`)].join('\n'),
          `Style: ${end(styleFor(n))}`,
          'Rules: Single film still, no text.',
        ),
        aspect: '16:9',
      };
    }
    case T.episode:
      return {
        prompt: lines(`Poster artwork for the episode "${name}".`, `About: ${end(t(n.params.description))}`, `Style: ${end(t(n.params.style) || 'Cinematic drama')}`, 'Rules: No text or lettering.'),
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
.dr-gen-link-btn, .dr-review-toggle { all: unset; cursor: pointer; font-size: 11.5px; color: var(--_accent); text-decoration: underline; align-self: flex-start; }
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
.dr-voices { display: flex; flex-direction: column; gap: 8px; }
.dr-voice { display: flex; flex-direction: column; gap: 3px; padding: 8px; border: 1px solid var(--_border); border-radius: 8px; background: var(--_node); }
.dr-voice-text { font-size: 13px; color: var(--_text); }
.dr-voice small { color: var(--_muted); }
.dr-voice-warn { color: #b42318 !important; }
.dr-clip-stale { font-size: 12px; color: #c92a2a; margin-top: 4px; }
.dr-scene-clips { display: flex; flex-direction: column; gap: 8px; }
.dr-scene-clips-intro { margin: 0; font-size: 13px; opacity: .8; }
.dr-scene-clips-list { display: flex; flex-direction: column; gap: 6px; }
.dr-scene-clip { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center; }
.dr-scene-clip small { grid-column: 2; opacity: .75; }
.dr-audio { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dr-audio audio { max-width: 100%; height: 36px; }
.dr-history { flex-basis: 100%; font-size: 13px; color: var(--_text); }
.dr-history > summary { cursor: pointer; color: var(--_muted); padding: 6px 0; }
.dr-history-item { border-top: 1px solid var(--_border); padding: 6px 0; }
.dr-history-item > summary { cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dr-history-item > summary img { width: 44px; height: 32px; object-fit: cover; border-radius: 4px; flex: none; }
.dr-history-item .dr-review { margin-top: 8px; }
.dr-history-item small { display: block; color: var(--_muted); margin-top: 4px; }
/* The prompt, laid out to read on a phone. */
.dr-review { display: flex; flex-direction: column; gap: 10px; font: 14px/1.5 var(--_font); color: var(--_text); }
.dr-review-part { border-left: 3px solid var(--_border); padding: 2px 0 2px 10px; }
.dr-review-part h4 { margin: 0 0 2px; font: 700 11px/1.2 var(--_font); letter-spacing: .06em; text-transform: uppercase; color: var(--_muted); }
.dr-review-part p { margin: 0 0 6px; }
.dr-review-part p:last-child { margin-bottom: 0; }
.dr-review-shot { border-left-color: var(--_accent); background: color-mix(in srgb, var(--_accent) 6%, transparent); border-radius: 0 8px 8px 0; padding: 6px 8px 6px 10px; font-size: 15px; }
.dr-review-rules { color: var(--_muted); font-size: 12px; }
.dr-review-ref { display: inline-flex; align-items: center; gap: 3px; vertical-align: middle; margin: 0 2px; padding: 1px 6px 1px 1px; border-radius: 999px;
  background: color-mix(in srgb, var(--_accent) 12%, var(--_node)); font: 700 11px/1 var(--_font); color: var(--_accent); }
.dr-review-ref img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
.dr-review-missing { background: #fde2e1; color: #b42318; padding-left: 6px; }
.dr-review-checks { border: 1px solid #f2c94c; background: color-mix(in srgb, #f2c94c 14%, var(--_node)); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.dr-review-checks ul { margin: 4px 0 0; padding-left: 18px; }
.dr-review-checks li { margin: 2px 0; }
.dr-review-pics { display: flex; flex-direction: column; gap: 4px; }
.dr-review-pics span { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dr-review-pics img { width: 40px; height: 30px; object-fit: cover; border-radius: 4px; flex: none; border: 1px solid var(--_border); }
.dr-views { display: flex; flex-direction: column; gap: 8px; }
.dr-view { display: grid; grid-template-columns: 72px 1fr; gap: 8px; align-items: start; }
.dr-view img { width: 72px; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid var(--_border); }
.dr-view > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dr-view textarea { font-size: 13px !important; min-height: 0 !important; resize: vertical; }
.dr-views-empty { color: var(--_muted); }
.dr-gen-card { all: unset; box-sizing: border-box; align-self: center; padding: 5px 10px; border: 1px solid var(--_border); border-radius: 999px;
  font: 600 12px/1.2 var(--_font); color: var(--_accent); background: var(--_node); cursor: pointer; white-space: nowrap; }
.dr-gen-card:hover, .dr-gen-card:focus-visible { border-color: var(--_accent); }
.nm-overview .dr-gen-card { visibility: hidden; }
.dr-confirm { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; border: 1px solid var(--_accent);
  background: color-mix(in srgb, var(--_accent) 8%, var(--_node)); }
.dr-confirm-text { font: 500 13px/1.4 var(--_font); color: var(--_text); }
/* A shot with a clip, on the board: its first frame, big. ▶ once the card is zoomed into. */
.nm-field:has(> .dr-clip-compact) { grid-template-columns: 1fr; padding: 4px 8px 8px; }
.nm-field:has(> .dr-clip-compact) > span { display: none; }
.dr-clip.dr-clip-compact { display: block; }
.dr-clip-card { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #111; }
.dr-clip-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dr-clip-len { position: absolute; bottom: 6px; right: 6px; font: 600 11px/1 var(--_font); color: #fff; background: rgba(0,0,0,.6); padding: 3px 6px; border-radius: 4px; }
/* Being made: the picture dimmed under the status, the time and a moving bar; the frame pulses. */
.dr-clip-card.dr-clip-making { outline: 2px solid var(--_accent); outline-offset: 2px; animation: dr-pulse 1.6s ease-in-out infinite; }
/* A picture being made, on a card: its placeholder pulses too. */
.nm-node .dr-pending.dr-thumb.dr-making { outline: 2px solid var(--_accent); outline-offset: 1px; animation: dr-pulse 1.6s ease-in-out infinite; }
.dr-clip-card .dr-pending.dr-clip-over { position: absolute; inset: 0; max-width: none; border: 0; border-radius: 0; background: rgba(12, 14, 24, .66); color: #fff; }
.dr-clip-card .dr-pending.dr-clip-over .dr-pending-label { color: #fff; font-size: 13px; }
.dr-clip-card .dr-pending.dr-clip-over .dr-pending-time { color: #fff; opacity: .8; }
.dr-clip-card .dr-pending.dr-clip-over::before { font-size: 26px; }
@keyframes dr-pulse { 50% { outline-color: color-mix(in srgb, var(--_accent) 30%, transparent); } }
.dr-clip-play { all: unset; position: absolute; inset: 0; margin: auto; width: 56px; height: 56px; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff;
  font-size: 22px; display: none; place-items: center; cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,.4); }
.nm-root:not(.nm-overview) .nm-node:is(.nm-selected, .nm-summary) .dr-clip-play { display: grid; }
.dr-clip-sum { margin-top: 5px; font-size: 12px; color: var(--_muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-gen-panel { box-sizing: border-box; min-width: 0; max-width: 100%; }
.dr-gen-panel :is(select, textarea, input:not([type=checkbox])) { box-sizing: border-box; max-width: 100%; }
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
