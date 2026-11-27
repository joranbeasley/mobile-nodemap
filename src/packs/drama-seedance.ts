import type { Graph } from '../core/graph.js';
import type { NodeInstance } from '../core/types.js';
import { cardId, dramaName, episodeInfo, imageList, previousShot, referenceImages, sceneInfo, setShotClipSuggester, shotCostumes, shotInfo, type EpisodeInfo, type SceneInfo } from './drama.js';

/**
 * Export a production for Seedance video generation, one generation per shot.
 * - A shot exports `shot.md` (duration, prompt, references) and its reference images, numbered
 *   in upload order (`images/01-…` becomes @Image1).
 * - A scene exports `scene.md`, one zip per shot and its optional storyboard.
 * - An episode, season or the whole map exports `script.md`, the shot zips and the storyboards.
 */

export interface SeedanceOptions {
  /** Look and feel added to every prompt. Episode and season `style` params override it. */
  style?: string;
  /** Aspect ratio stated in the script. Episode and season `aspect` params override it. */
  aspect?: string;
  /** Longest clip a generation may ask for, in seconds. Default 15. */
  maxClip?: number;
  /** Shortest clip. Default 4. */
  minClip?: number;
  /** Most reference images per generation. Default 9. */
  maxImages?: number;
  /**
   * Credits per generated second, per model, for the cost estimate. Default: Dreamina's
   * published 720p Seedance 2.0 rates (Pro 17, Fast 8, Mini 5). Prices change: check yours.
   */
  rates?: Record<string, number>;
  /** Expected takes per shot (retries) for the "budget" line. Default 3. */
  takes?: number;
}

/** Dreamina's published 720p Seedance 2.0 credits per generated second (they change: check). */
export const SEEDANCE_RATES: Record<string, number> = { Pro: 17, Fast: 8, Mini: 5 };

/** Credits for some seconds of video, per model. */
export interface SeedanceCost {
  seconds: number;
  /** Credits per model for one take of everything. */
  credits: Record<string, number>;
  takes: number;
}

export function seedanceCost(seconds: number, opts: SeedanceOptions = {}): SeedanceCost {
  const rates = opts.rates ?? SEEDANCE_RATES;
  return { seconds, takes: opts.takes ?? 3, credits: Object.fromEntries(Object.entries(rates).map(([m, r]) => [m, Math.round(seconds * r)])) };
}

const costLine = (c: SeedanceCost) =>
  Object.entries(c.credits)
    .map(([m, n]) => `${n.toLocaleString('en')} (${m})`)
    .join(' · ');
const costMarkdown = (c: SeedanceCost, what: string) => [
  `**Estimated cost:** ${c.seconds} s of video. One take of ${what}: ${costLine(c)} credits.`,
  ...(c.takes > 1
    ? [`With about ${c.takes} takes per shot: ${costLine({ ...c, credits: Object.fromEntries(Object.entries(c.credits).map(([m, n]) => [m, n * c.takes])) })} credits.`]
    : []),
  '',
  '_Dreamina 720p Seedance 2.0 rates per generated second; prices change, so check before you buy. Higher resolutions cost more._',
];

export interface SeedanceAsset {
  /** Path inside its zip, e.g. `images/01-maya.png` (shot packs) or `storyboard/scene-1-01.png`. */
  path: string;
  /** The image as stored on the node (data: URL or web URL). */
  src: string;
  /** What it shows, e.g. "Maya (character)". */
  label: string;
  /** The card it comes from, for a card's picture (characters, places, props, costumes). */
  card?: string;
}

/** One shot = one Seedance generation, packed as its own zip. */
export interface SeedanceShot {
  /** The shot node. */
  id: string;
  /** "Ep 1 · Scene 1 · Shot 2" */
  title: string;
  /** Estimated credits for one take. */
  cost: SeedanceCost;
  /** Zip name inside a scene, episode or season pack, e.g. `shots/02-scene-1-shot-2.zip`. */
  zipPath: string;
  /** Clip length asked for, in seconds (the shot's length, kept between the min and max). */
  duration: number;
  /** Upload order: refs[0] is @Image1. Paths are inside the shot's zip (`images/01-maya.png`). */
  refs: SeedanceAsset[];
  /** Images over the per-clip limit, not included. */
  dropped: SeedanceAsset[];
  prompt: string;
  /** shot.md */
  markdown: string;
}

export interface SeedanceScript {
  title: string;
  /** What the export covers. */
  kind: 'shot' | 'scene' | 'episode' | 'season' | 'production';
  /** Root markdown file name: shot.md, scene.md or script.md. */
  rootFile: string;
  markdown: string;
  /** Estimated credits for all its shots. */
  cost: SeedanceCost;
  shots: SeedanceShot[];
  /** Scene storyboard images, at `storyboard/…` in the pack. */
  storyboard: SeedanceAsset[];
}


const DEFAULT_STYLE = 'Cinematic live-action drama, natural light, shallow depth of field, realistic performances';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'image';

/** File extension for an image source; SVG sketches are rasterised to JPEG in the pack. */
function extOf(src: string): string {
  const m = /^data:image\/([\w.+-]+)[;,]/i.exec(src);
  const type = m ? m[1].toLowerCase() : (/\.(jpe?g|png|webp|gif|svg)(?:[?#]|$)/i.exec(src)?.[1] ?? 'jpg').toLowerCase();
  return { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', 'svg+xml': 'jpg', svg: 'jpg' }[type] ?? 'jpg';
}

const FRAMING: Record<string, string> = {
  Wide: 'Wide shot',
  Full: 'Full shot',
  Medium: 'Medium shot',
  'Close-up': 'Close-up',
  'Extreme close-up': 'Extreme close-up',
  'Two-shot': 'Two-shot',
  'Over the shoulder': 'Over-the-shoulder shot',
  'Point of view': 'POV shot',
  Insert: 'Insert shot',
};
const MOVE: Record<string, string> = {
  Static: 'static camera',
  Pan: 'slow pan',
  Tilt: 'slow tilt',
  Dolly: 'slow dolly-in',
  Tracking: 'tracking shot',
  Handheld: 'handheld camera',
  Crane: 'rising crane move',
  Zoom: 'slow zoom-in',
};
const TIME: Record<string, string> = { DAY: 'day', NIGHT: 'night', MORNING: 'morning', EVENING: 'evening', CONTINUOUS: 'continuous', LATER: 'later' };

const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();
const sentence = (t: string) => {
  const s = oneLine(t);
  return !s ? '' : /[.!?…”"']$/.test(s) ? s : `${s}.`;
};
const mdEsc = (t: string) => t.replace(/([\\`*_[\]|<>])/g, '\\$1');

/** Which scenes, episodes and seasons an id covers (or the whole map). */
function scope(graph: Graph, id?: string) {
  const all = [...graph.nodes.values()];
  const out = (n: NodeInstance) => graph.outgoing(n.id).map((e) => graph.nodes.get(e.to.node)!).filter(Boolean);
  const episodesOf = (season: NodeInstance) =>
    graph
      .incoming(season.id)
      .filter((e) => e.to.port === 'episodes')
      .map((e) => graph.nodes.get(e.from.node)!)
      .filter(Boolean)
      .map((e) => episodeInfo(graph, e))
      .sort((a, b) => a.number - b.number);
  const node = id ? graph.nodes.get(id) : undefined;
  const seasons: { node: NodeInstance; episodes: EpisodeInfo[] }[] = [];
  const episodes: EpisodeInfo[] = [];
  const scenes: SceneInfo[] = [];
  if (node?.type === 'drama/scene') scenes.push(sceneInfo(graph, node));
  else if (node?.type === 'drama/episode') episodes.push(episodeInfo(graph, node));
  else if (node?.type === 'drama/season') seasons.push({ node, episodes: episodesOf(node) });
  else {
    for (const s of all.filter((n) => n.type === 'drama/season').sort((a, b) => Number(a.params.number ?? 1) - Number(b.params.number ?? 1))) seasons.push({ node: s, episodes: episodesOf(s) });
    episodes.push(...all.filter((n) => n.type === 'drama/episode' && !out(n).length).map((e) => episodeInfo(graph, e)).sort((a, b) => a.number - b.number));
    scenes.push(...all.filter((n) => n.type === 'drama/scene' && !out(n).length).map((s) => sceneInfo(graph, s)).sort((a, b) => a.number - b.number));
  }
  const title = node ? (node.type === 'drama/scene' ? `Scene ${Number(node.params.number ?? 1)}` : dramaName(node)) : seasons[0] ? dramaName(seasons[0].node) : episodes[0]?.title ?? 'Production';
  return { node, seasons, episodes, scenes, title };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Settings for a shot: from its scene's episode, then the season, then the options. */
function settingsFor(graph: Graph, shot: NodeInstance, opts: SeedanceOptions) {
  const parent = (n: NodeInstance | undefined, type: string) => n && graph.outgoing(n.id).map((e) => graph.nodes.get(e.to.node)).find((x) => x?.type === type);
  const scene = parent(shot, 'drama/scene');
  const episode = parent(scene, 'drama/episode');
  const season = parent(episode, 'drama/season');
  const set = (v: unknown) => (v && v !== 'inherit' ? String(v) : '');
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
  const minClip = opts.minClip ?? 4;
  return {
    scene,
    episode,
    season,
    style: oneLine(String(episode?.params.style ?? '') || String(season?.params.style ?? '') || opts.style || DEFAULT_STYLE),
    aspect: set(episode?.params.aspect) || set(season?.params.aspect) || opts.aspect || '16:9',
    minClip,
    maxClip: Math.max(minClip, num(episode?.params.maxClip) || num(season?.params.maxClip) || opts.maxClip || 15),
    maxImages: Math.max(1, Math.round(num(episode?.params.maxImages) || num(season?.params.maxImages) || opts.maxImages || 9)),
  };
}

/**
 * One shot as one Seedance generation: its reference images in upload order (named
 * `images/01-…`, `images/02-…` so the order is obvious), a prompt and its shot.md.
 */
export function seedanceShot(graph: Graph, shotId: string, opts: SeedanceOptions = {}, zipPath = ''): SeedanceShot {
  const node = graph.nodes.get(shotId);
  if (node?.type !== 'drama/shot') throw new Error(`${shotId} is not a shot`);
  const x = shotInfo(graph, node);
  const cfg = settingsFor(graph, node, opts);
  const scene = cfg.scene ? sceneInfo(graph, cfg.scene) : undefined;
  const title = [cfg.episode ? `Ep ${Number(cfg.episode.params.number ?? 1)}` : '', scene ? `Scene ${scene.number}` : '', `Shot ${x.number}`].filter(Boolean).join(' · ');

  // Candidates in priority order: who and where first, then the shot's frames, then extra angles.
  type Cand = { src: string; name: string; label: string; card?: string };
  const cands: Cand[] = [];
  const first: Cand[] = [];
  const rest: Cand[] = [];
  // Each card's picture picked for this shot (else its first) leads; its other pictures follow as
  // extra views, unless one was picked: then only that one goes.
  const add = (n: NodeInstance, kind: string, name = dramaName(n)) => {
    const r = referenceImages(n, node);
    if (!r.picked) return;
    const card = cardId(n.id);
    first.push({ src: r.picked, name, label: `${dramaName(n)} (${kind})`, card });
    if (!r.explicit) r.all.filter((src) => src !== r.picked).forEach((src) => rest.push({ src, name, label: `${dramaName(n)} (${kind}, view ${r.all.indexOf(src) + 1})`, card }));
  };
  // What each character wears in this shot: the scene's costumes, or the shot's own.
  const costumes = shotCostumes(graph, shotId);
  x.characters.forEach((c) => add(c, 'character'));
  x.characters.forEach((c) => {
    const k = costumes.get(c.id);
    if (k) add(k, `${dramaName(c)}'s costume`, `${dramaName(c)}-costume`);
  });
  if (x.location) add(x.location, 'location');
  x.props.forEach((p) => add(p, 'prop'));
  // How the shot before ended (its finished clip's last frame): the first frame of a shot that
  // carries on from it, or a continuity reference for one that cuts to it.
  const prev = previousShot(graph, node);
  const prevNo = prev ? String(prev.params.number ?? '').trim() || '?' : '';
  const prevEnd = typeof prev?.params.lastFrame === 'string' && prev.params.lastFrame ? prev.params.lastFrame : undefined;
  const continues = !!node.params.continues && !!prev;
  const startFrame = continues && prevEnd ? { src: prevEnd, name: `shot-${prevNo}-last-frame`, label: `Last frame of shot ${prevNo}'s clip (first frame)` } : undefined;
  if (startFrame) cands.push(startFrame);
  cands.push(...first);
  if (!continues) x.images.forEach((src, i) => cands.push({ src, name: `shot-${x.number}-frame`, label: `Shot ${x.number} storyboard frame${x.images.length > 1 ? ` ${i + 1}` : ''}` }));
  if (prevEnd && !continues) cands.push({ src: prevEnd, name: `shot-${prevNo}-end`, label: `End of shot ${prevNo} (continuity)` });
  cands.push(...rest);

  const refs: SeedanceAsset[] = [];
  const dropped: SeedanceAsset[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    if (seen.has(c.src)) continue;
    seen.add(c.src);
    const n = refs.length < cfg.maxImages ? refs.length + 1 : refs.length + dropped.length + 1;
    const a = { path: `images/${pad(n)}-${slug(c.name)}.${extOf(c.src)}`, src: c.src, label: c.label, ...(c.card ? { card: c.card } : {}) };
    (refs.length < cfg.maxImages ? refs : dropped).push(a);
  }
  const refsOf = (n: NodeInstance) => imageList(n.params.images).map((src) => refs.find((r) => r.src === src)).filter((r): r is SeedanceAsset => !!r).map((r) => `@Image${refs.indexOf(r) + 1}`);

  const duration = Math.min(cfg.maxClip, Math.max(cfg.minClip, x.duration));
  const lines: string[] = [];
  lines.push(`${sentence(cfg.style)} Aspect ratio ${cfg.aspect}.`);
  if (x.characters.length) {
    lines.push('Characters:');
    for (const c of x.characters) {
      const r = refsOf(c);
      const d = oneLine(String(c.params.description ?? '')).split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, '');
      const parts = [`${dramaName(c)}${r.length ? ` is ${r[0]}${r.length > 1 ? ` (more angles: ${r.slice(1).join(', ')})` : ''}` : ''}${d ? `, ${d.charAt(0).toLowerCase()}${d.slice(1)}` : ''}.`];
      // Appearance goes in word for word, every time: fixed wording keeps separate clips consistent.
      const look = oneLine(String(c.params.appearance ?? ''));
      if (look) parts.push(`Appearance: ${sentence(look)}`);
      const k = costumes.get(c.id);
      if (k) {
        const kr = refsOf(k);
        const what = oneLine(String(k.params.description ?? '')) || dramaName(k);
        parts.push(`Costume in this scene: ${what.replace(/[.!?]$/, '')}${kr.length ? ` (${kr.join(', ')})` : ''}; it replaces their usual clothes.`);
      }
      lines.push(`- ${parts.join(' ')}`);
    }
  }
  if (x.location) {
    const l = x.location;
    const r = refsOf(l);
    const d = oneLine(String(l.params.description ?? ''));
    lines.push(`Setting: ${dramaName(l)}${r.length ? ` (${r.join(', ')})` : ''}, ${l.params.setting === 'EXT' ? 'exterior' : 'interior'}, ${TIME[scene?.time ?? 'DAY'] ?? 'day'}.${d ? ` ${sentence(d)}` : ''}`);
  }
  if (x.props.length) lines.push(`Props: ${x.props.map((p) => `${dramaName(p)}${refsOf(p).length ? ` (${refsOf(p).join(', ')})` : ''}`).join(', ')}.`);
  if (scene?.description) lines.push(`Scene context: ${sentence(scene.description)}`);
  lines.push('');
  const action = [`${FRAMING[x.framing] ?? x.framing}, ${MOVE[x.movement] ?? x.movement.toLowerCase()}.`];
  if (x.characters.length) action.push(`On screen: ${and(x.characters.map(dramaName))}.`);
  if (x.description) action.push(sentence(x.description));
  const frames = continues ? [] : x.images.map((src) => refs.find((r) => r.src === src)).filter((r): r is SeedanceAsset => !!r);
  if (frames.length) action.push(`Match the composition of ${frames.map((f) => `@Image${refs.indexOf(f) + 1}`).join(' and ')}.`);
  const at = (src?: string) => {
    const i = src ? refs.findIndex((r) => r.src === src) : -1;
    return i >= 0 ? `@Image${i + 1}` : undefined;
  };
  if (continues) {
    const start = at(startFrame?.src);
    action.unshift(
      start
        ? `Start exactly on ${start}, the last frame of shot ${prevNo}, as the first frame, and carry the action on from there without a cut: same camera, light and positions.`
        : `Carries straight on from shot ${prevNo} without a cut.`,
    );
  } else if (at(prevEnd)) action.push(`Keep props, positions and lighting continuous with how shot ${prevNo} ended (${at(prevEnd)}).`);
  lines.push(`Shot (0–${duration} s): ${action.join(' ')}`);
  lines.push('');
  const dressed = x.characters.some((c) => costumes.has(c.id));
  lines.push(
    `${dressed ? "Keep each character's face and hair consistent with their character images and their clothes consistent with their costume." : "Keep every character's face, hair and clothes consistent with their reference images."} One continuous shot. No subtitles, captions or on-screen text.`,
  );
  const prompt = lines.join('\n');

  const md: string[] = [];
  md.push(`# ${mdEsc(title)}: Seedance shot`, '');
  md.push(`**Duration:** ${duration} s · **Aspect ratio:** ${cfg.aspect} · **Framing:** ${mdEsc(x.framing)}, ${mdEsc(x.movement.toLowerCase())}`, '');
  if (continues && startFrame)
    md.push(`> **Continues shot ${prevNo}.** Use @Image1 (the last frame of shot ${prevNo}'s clip) as the **first frame**, so the two clips join without a cut.`, '');
  else if (continues)
    md.push(`> **Continues shot ${prevNo}.** Add shot ${prevNo}'s finished clip to its card (🎞 clip) and export again: its last frame becomes this clip's first frame. Or take that frame yourself and use it as the first frame.`, '');
  const part2 = x.duration > cfg.maxClip ? Math.max(cfg.minClip, Math.min(cfg.maxClip, x.duration - cfg.maxClip)) : 0;
  if (part2) md.push(`> This shot is ${x.duration} s; clips here stop at ${cfg.maxClip} s, so it is generated in two parts (see Part 2 below). Or raise “clip seconds” on the episode or season.`, '');
  if (x.duration < cfg.minClip) md.push(`> This shot is ${x.duration} s; Seedance clips are at least ${cfg.minClip} s, so trim it in the edit.`, '');
  if (refs.length) {
    md.push('**Upload these images in this order** (they become @Image1, @Image2…):', '');
    md.push('| Reference | Image | Shows |', '| --- | --- | --- |');
    refs.forEach((a, i) => md.push(`| @Image${i + 1} | ![${mdEsc(a.label)}](${a.path}) \`${a.path}\` | ${mdEsc(a.label)} |`));
    md.push('');
  } else md.push('No reference images: add pictures to the characters, location or shot to keep them consistent.', '');
  if (dropped.length) md.push(`> Left out (this script allows ${cfg.maxImages} images per clip; raise “reference images” on the episode or season for more): ${dropped.map((a) => mdEsc(a.label)).join(', ')}`, '');
  md.push('**Prompt**', '', '```text', prompt, '```', '');
  if (part2)
    md.push(
      `**Part 2** (${part2} s): when the clip above is done, use its last frame as the **first frame** of a second clip, with the same reference images and this prompt:`,
      '',
      '```text',
      `Carry straight on from the first frame without a cut: same camera, light and positions, for ${part2} more seconds. ${x.description ? sentence(x.description) : ''}`.trim(),
      '```',
      '',
    );
  const cost = seedanceCost(duration, opts);
  md.push(...costMarkdown(cost, 'this shot'), '');
  return { id: node.id, title, zipPath, duration, cost, refs, dropped, prompt, markdown: md.join('\n') };
}

/**
 * The Seedance script for a shot, scene, episode or season (by id), or the whole map.
 * A shot gives its shot.md. Anything bigger gives a root file (scene.md for a scene,
 * script.md otherwise) that lists every shot's pack and prompt, plus the scenes'
 * storyboards. Pure: no DOM needed. `seedancePack` builds the zips.
 */
export function seedanceScript(graph: Graph, id?: string, opts: SeedanceOptions = {}): SeedanceScript {
  const node = id ? graph.nodes.get(id) : undefined;
  if (node?.type === 'drama/shot') {
    const shot = seedanceShot(graph, node.id, opts, 'shot.zip');
    return { title: shot.title, kind: 'shot', rootFile: 'shot.md', markdown: shot.markdown, cost: shot.cost, shots: [shot], storyboard: [] };
  }
  const sc = scope(graph, id);
  const kind: SeedanceScript['kind'] = node?.type === 'drama/scene' ? 'scene' : node?.type === 'drama/episode' ? 'episode' : node?.type === 'drama/season' ? 'season' : 'production';

  type Block = { episode?: EpisodeInfo; season?: NodeInstance; scene: SceneInfo };
  const blocks: Block[] = [];
  for (const s of sc.seasons) for (const e of s.episodes) for (const scene of e.scenes) blocks.push({ season: s.node, episode: e, scene });
  for (const e of sc.episodes) for (const scene of e.scenes) blocks.push({ episode: e, scene });
  for (const scene of sc.scenes) blocks.push({ scene });

  // Shot packs, named in story order: shots/03-scene-1-shot-3.zip
  const total = blocks.reduce((t, b) => t + b.scene.shots.length, 0);
  const w = Math.max(2, String(total).length);
  let seq = 0;
  const shots: SeedanceShot[] = [];
  const storyboard: SeedanceAsset[] = [];
  const perBlock = new Map<Block, { shots: SeedanceShot[]; board: SeedanceAsset[] }>();
  for (const b of blocks) {
    const where = [kind === 'season' || kind === 'production' ? (b.episode ? `ep-${b.episode.number}` : '') : '', kind === 'scene' ? '' : `scene-${b.scene.number}`].filter(Boolean).join('-');
    const list = b.scene.shots.map((x) => seedanceShot(graph, x.node.id, opts, `shots/${pad(++seq, w)}-${where ? `${where}-` : ''}shot-${slug(x.number)}.zip`));
    const board = imageList(b.scene.node.params.storyboard).map((src, i) => ({
      path: `storyboard/${where || `scene-${b.scene.number}`}-${pad(i + 1)}.${extOf(src)}`,
      src,
      label: `Scene ${b.scene.number} storyboard ${i + 1}`,
    }));
    shots.push(...list);
    storyboard.push(...board);
    perBlock.set(b, { shots: list, board });
  }

  const cast = new Map<string, NodeInstance>();
  const places = new Map<string, NodeInstance>();
  const props = new Map<string, NodeInstance>();
  for (const b of blocks)
    for (const s of b.scene.shots) {
      s.characters.forEach((c) => cast.set(c.id, c));
      if (s.location) places.set(s.location.id, s.location);
      s.props.forEach((p) => props.set(p.id, p));
    }

  const rootFile = kind === 'scene' ? 'scene.md' : 'script.md';
  const md: string[] = [];
  const secs = shots.reduce((t, s) => t + s.duration, 0);
  md.push(`# ${mdEsc(sc.title)}: Seedance script`, '');
  md.push(`${shots.length} shot${shots.length === 1 ? '' : 's'} · ${Math.floor(secs / 60)}:${pad(secs % 60)} of video${storyboard.length ? ` · ${storyboard.length} storyboard image${storyboard.length === 1 ? '' : 's'}` : ''}`, '');
  md.push(
    ...costMarkdown(seedanceCost(secs, opts), shots.length === 1 ? 'the shot' : `all ${shots.length} shots`),
    '',
    '**How to use.** Every shot is one Seedance generation with its own pack in `shots/`. Each pack holds `shot.md` (duration, prompt) and its reference images, numbered in upload order (`images/01-…`, `images/02-…`). Upload them in that order so they become @Image1, @Image2 and so on, set the duration, paste the prompt, then join the clips in shot order.',
    '',
  );
  const sheet = (title: string, nodes: NodeInstance[], extra: (n: NodeInstance) => string, more: (n: NodeInstance) => string = () => '') => {
    if (!nodes.length) return;
    md.push(`## ${title}`, '');
    for (const n of nodes) {
      const e = extra(n);
      const d = oneLine(String(n.params.description ?? ''));
      const m = more(n);
      md.push(`- **${mdEsc(dramaName(n))}**${e ? ` (${e})` : ''}${d ? `: ${mdEsc(d)}` : ''}${m ? ` ${m}` : ''}`);
    }
    md.push('');
  };
  sheet('Characters', [...cast.values()], (c) => (c.params.actor ? `played by ${mdEsc(String(c.params.actor))}` : ''), (c) => {
    const look = oneLine(String(c.params.appearance ?? ''));
    return look ? `Appearance: ${mdEsc(look)}` : '';
  });
  sheet('Locations', [...places.values()], (l) => (l.params.setting === 'EXT' ? 'exterior' : 'interior'));
  sheet('Props', [...props.values()], () => '');

  let lastSeason: NodeInstance | undefined;
  let lastEpisode: EpisodeInfo | undefined;
  for (const b of blocks) {
    if (b.season && b.season !== lastSeason) {
      lastSeason = b.season;
      const d = String(b.season.params.description ?? '').trim();
      md.push(`## ${mdEsc(dramaName(b.season))} (season ${Number(b.season.params.number ?? 1)})`, '', ...(d ? [mdEsc(d), ''] : []));
    }
    if (b.episode && b.episode !== lastEpisode) {
      lastEpisode = b.episode;
      md.push(`## Episode ${b.episode.number}: ${mdEsc(b.episode.title)}`, '', ...(b.episode.description ? [mdEsc(b.episode.description), ''] : []));
    }
    const s = b.scene;
    const { shots: list, board } = perBlock.get(b)!;
    md.push(`### Scene ${s.number}. ${mdEsc(s.slug)}`, '');
    if (s.description) md.push(mdEsc(s.description), '');
    if (s.costumes.length)
      md.push(`**Costumes:** ${s.costumes.map((c) => `${mdEsc(c.character ? dramaName(c.character) : '?')}: ${mdEsc(oneLine(String(c.costume.params.description ?? '')) || dramaName(c.costume))}`).join('; ')}`, '');
    if (board.length) md.push('**Storyboard**', '', board.map((a) => `![${mdEsc(a.label)}](${a.path})`).join(' '), '');
    if (!list.length) {
      md.push('_No shots yet._', '');
      continue;
    }
    md.push('| Shot | Pack | Length | Images | On screen |', '| --- | --- | --- | --- | --- |');
    list.forEach((shot, i) => {
      const x = s.shots[i];
      md.push(`| ${mdEsc(x.number)} · ${mdEsc(x.framing)} | \`${shot.zipPath}\` | ${shot.duration} s | ${shot.refs.length} | ${mdEsc(x.characters.map(dramaName).join(', ') || '—')} |`);
    });
    md.push('');
    list.forEach((shot, i) => {
      md.push(`#### Shot ${mdEsc(s.shots[i].number)} · ${shot.duration} s · \`${shot.zipPath}\``, '');
      md.push(`Upload: ${shot.refs.map((r, j) => `@Image${j + 1} ${mdEsc(r.label)}`).join(' · ') || 'no images'}`, '');
      md.push('```text', shot.prompt, '```', '');
    });
  }
  if (!blocks.length) md.push('_Nothing to film yet: wire shots into scenes._', '');
  return { title: sc.title, kind, rootFile, markdown: md.join('\n').replace(/\n{3,}/g, '\n\n'), cost: seedanceCost(secs, opts), shots, storyboard };
}


// ------------------------------------------------------------------ zip

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (d: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A .zip (stored, no compression: images are compressed already). */
export function zip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((t, c) => t + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ------------------------------------------------------------------ images to bytes

function dataUrlBytes(src: string): { bytes: Uint8Array; type: string } | undefined {
  const m = /^data:([^;,]*)((?:;[^,]*)*),(.*)$/s.exec(src);
  if (!m) return undefined;
  const type = m[1] || 'text/plain';
  if (/;base64/i.test(m[2])) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), type };
}

/** Draw an SVG to a JPEG (Seedance wants raster images). Undefined where there is no canvas. */
async function rasterize(svgSrc: string, width = 1024): Promise<Uint8Array | undefined> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return undefined;
  try {
    const img = new Image();
    img.src = svgSrc;
    await img.decode();
    const w = width;
    const h = Math.round((width * (img.naturalHeight || 100)) / (img.naturalWidth || 160));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // toDataURL, not toBlob: Chromium can hold toBlob encodes for seconds as idle work.
    const url = c.toDataURL('image/jpeg', 0.9);
    return url.startsWith('data:image/jpeg') ? dataUrlBytes(url)?.bytes : undefined;
  } catch {
    return undefined;
  }
}

/** Image bytes for the pack: SVG rasterised to JPEG, web images fetched. `ext` may differ from the planned one. */
async function imageBytes(src: string): Promise<{ bytes: Uint8Array; ext?: string } | undefined> {
  const d = src.startsWith('data:') ? dataUrlBytes(src) : undefined;
  if (d && /svg/i.test(d.type)) {
    const png = await rasterize(src);
    return png ? { bytes: png } : { bytes: d.bytes, ext: 'svg' };
  }
  if (d) return { bytes: d.bytes };
  try {
    const res = await fetch(src);
    if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    /* cross-origin or offline: link it instead */
  }
  return undefined;
}

/** Put images into `files` at their paths, fixing the markdown where a path had to change. */
async function addImages(assets: SeedanceAsset[], markdown: string, files: { path: string; data: Uint8Array }[], cache: Map<string, Awaited<ReturnType<typeof imageBytes>>>) {
  for (const a of assets) {
    if (!cache.has(a.src)) cache.set(a.src, await imageBytes(a.src));
    const got = cache.get(a.src);
    if (!got) {
      markdown = markdown.split(a.path).join(a.src);
      continue;
    }
    const path = got.ext ? a.path.replace(/\.[a-z]+$/, `.${got.ext}`) : a.path;
    if (path !== a.path) markdown = markdown.split(a.path).join(path);
    files.push({ path, data: got.bytes });
  }
  return markdown;
}

const enc = (t: string) => new TextEncoder().encode(t);

/**
 * Zip a Seedance export.
 * - A shot: `shot.md` and `images/01-…` (its references in upload order).
 * - A scene: `scene.md`, one zip per shot in `shots/`, and the storyboard in `storyboard/`.
 * - An episode, season or the whole map: `script.md`, the shot zips and the storyboards.
 * SVG pictures become 1024 px JPEGs (SVG where there is no canvas); web images are fetched,
 * or linked by URL when they can't be.
 */
export async function seedancePack(graph: Graph, id?: string, opts: SeedanceOptions = {}): Promise<{ filename: string; blob: Blob; script: SeedanceScript }> {
  const script = seedanceScript(graph, id, opts);
  const cache = new Map<string, Awaited<ReturnType<typeof imageBytes>>>();
  // Convert every distinct image once, in parallel; shot packs then reuse the bytes.
  const srcs = [...new Set([...script.shots.flatMap((s) => s.refs), ...script.storyboard].map((a) => a.src))];
  await Promise.all(srcs.map(async (src) => cache.set(src, await imageBytes(src))));
  const shotZip = async (shot: SeedanceShot) => {
    const files: { path: string; data: Uint8Array }[] = [];
    const markdown = await addImages(shot.refs, shot.markdown, files, cache);
    files.unshift({ path: 'shot.md', data: enc(markdown) });
    return zip(files);
  };
  let data: Uint8Array;
  if (script.kind === 'shot') data = await shotZip(script.shots[0]);
  else {
    const files: { path: string; data: Uint8Array }[] = [];
    for (const s of script.shots) files.push({ path: s.zipPath, data: await shotZip(s) });
    const markdown = await addImages(script.storyboard, script.markdown, files, cache);
    files.unshift({ path: script.rootFile, data: enc(markdown) });
    data = zip(files);
  }
  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/zip' });
  return { filename: `${slug(script.title)}-seedance.zip`, blob, script };
}


// ------------------------------------------------------------------ saving files

export type FileSaver = (file: { filename: string; data: Blob | string }) => void | Promise<unknown>;

let saver: FileSaver = ({ filename, data }) => {
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/markdown' }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** How drama exports reach the person: a browser download by default. Hosts can replace it. */
export function setDramaFileSaver(fn: FileSaver): void {
  saver = fn;
}
export const saveDramaFile: FileSaver = (f) => saver(f);

// 🎬 Generate clip (drama.ts) starts from this export: the same prompt, pictures in the same
// order (the prompt calls them @Image1…), the clip length and aspect ratio.
setShotClipSuggester((graph, shotId) => {
  const node = graph.nodes.get(shotId);
  if (node?.type !== 'drama/shot') return undefined;
  const shot = seedanceShot(graph, shotId);
  const first = node.params.continues && shot.refs[0]?.label.endsWith('(first frame)') ? shot.refs[0].src : undefined;
  return {
    prompt: shot.prompt,
    references: shot.refs.map((r) => {
      // Which card it's from, and what else that card has, so people can pick another.
      const all = r.card ? imageList(graph.nodes.get(r.card)?.params.images) : [];
      return { src: r.src, label: r.label, ...(r.card ? { card: r.card } : {}), ...(all.length > 1 ? { choices: all } : {}) };
    }),
    firstFrame: first,
    duration: shot.duration,
    aspect: settingsFor(graph, node, {}).aspect,
  };
});
