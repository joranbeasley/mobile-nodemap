import type { Graph } from '../core/graph.js';
import type { NodeInstance } from '../core/types.js';
import { dramaName, episodeInfo, imageList, sceneInfo, type EpisodeInfo, type SceneInfo, type ShotInfo } from './drama.js';

/**
 * Export a production as a Seedance video script: Markdown with one "generation" (one clip of
 * 4–15 s) per run of shots, the reference images each generation should upload (they become
 * @Image1, @Image2… in upload order, at most 9), and a prompt that names them. An asset pack
 * (.zip) holds script.md plus every image under assets/, at the paths the script uses.
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
}

export interface SeedanceAsset {
  /** Path inside the pack, e.g. `assets/characters/maya-1.jpg`. */
  path: string;
  /** The image as stored on the node (data: URL or web URL). */
  src: string;
  /** What it shows, e.g. "Maya (character)". */
  label: string;
}

export interface SeedanceGeneration {
  title: string;
  duration: number;
  /** Upload order: refs[0] is @Image1. */
  refs: SeedanceAsset[];
  prompt: string;
}

export interface SeedanceScript {
  title: string;
  markdown: string;
  assets: SeedanceAsset[];
  generations: SeedanceGeneration[];
}

const DEFAULT_STYLE = 'Cinematic live-action drama, natural light, shallow depth of field, realistic performances';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'image';

/** File extension for an image source; SVG sketches are rasterised to PNG in the pack. */
function extOf(src: string): string {
  const m = /^data:image\/([\w.+-]+)[;,]/i.exec(src);
  const type = m ? m[1].toLowerCase() : (/\.(jpe?g|png|webp|gif|svg)(?:[?#]|$)/i.exec(src)?.[1] ?? 'jpg').toLowerCase();
  return { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', 'svg+xml': 'png', svg: 'png' }[type] ?? 'jpg';
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

/** Split a scene's shots into clips no longer than `max` seconds. */
function clips(shots: ShotInfo[], max: number): ShotInfo[][] {
  const out: ShotInfo[][] = [];
  let cur: ShotInfo[] = [];
  let t = 0;
  for (const s of shots) {
    const d = Math.max(1, s.duration);
    if (cur.length && t + d > max) {
      out.push(cur);
      cur = [];
      t = 0;
    }
    cur.push(s);
    t += d;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Build the Seedance script for a scene, episode or season (by id), or for the whole map.
 * Pure: no DOM needed. Use `seedancePack` for the .zip with the images.
 */
export function seedanceScript(graph: Graph, id?: string, opts: SeedanceOptions = {}): SeedanceScript {
  const minClip = opts.minClip ?? 4;
  const sc = scope(graph, id);

  // ---- assets: one path per distinct image, named after what it shows
  const bySrc = new Map<string, SeedanceAsset>();
  const used = new Set<string>();
  const asset = (src: string, folder: string, base: string, label: string): SeedanceAsset => {
    const known = bySrc.get(src);
    if (known) return known;
    let path = '';
    for (let i = 1; !path || used.has(path); i++) path = `assets/${folder}/${slug(base)}-${i}.${extOf(src)}`;
    used.add(path);
    const a = { path, src, label };
    bySrc.set(src, a);
    return a;
  };
  const imagesOf = (n: NodeInstance, folder: string, label: string, param = 'images') => imageList(n.params[param]).map((src) => asset(src, folder, dramaName(n), label));

  // ---- collect everything in scope, in story order
  type Block = { episode?: EpisodeInfo; season?: NodeInstance; scene: SceneInfo };
  const blocks: Block[] = [];
  for (const s of sc.seasons) for (const e of s.episodes) for (const scene of e.scenes) blocks.push({ season: s.node, episode: e, scene });
  for (const e of sc.episodes) for (const scene of e.scenes) blocks.push({ episode: e, scene });
  for (const scene of sc.scenes) blocks.push({ scene });

  const cast = new Map<string, NodeInstance>();
  const places = new Map<string, NodeInstance>();
  const props = new Map<string, NodeInstance>();
  for (const b of blocks)
    for (const s of b.scene.shots) {
      s.characters.forEach((c) => cast.set(c.id, c));
      if (s.location) places.set(s.location.id, s.location);
      s.props.forEach((p) => props.set(p.id, p));
    }

  // Reference sheet images first, so they get the tidiest names.
  const castImages = new Map([...cast.values()].map((c) => [c.id, imagesOf(c, 'characters', `${dramaName(c)} (character)`)]));
  const placeImages = new Map([...places.values()].map((l) => [l.id, imagesOf(l, 'locations', `${dramaName(l)} (location)`)]));
  const propImages = new Map([...props.values()].map((p) => [p.id, imagesOf(p, 'props', `${dramaName(p)} (prop)`)]));

  // An episode exported on its own still takes its season's style and aspect.
  // Settings come from the scene's episode, then its season, then opts: a scene or episode
  // exported on its own still uses them.
  const parent = (n: NodeInstance | undefined, type: string) => n && graph.outgoing(n.id).map((e) => graph.nodes.get(e.to.node)).find((x) => x?.type === type);
  const episodeOf = (b: Block) => b.episode?.node ?? parent(b.scene.node, 'drama/episode');
  const seasonOf = (b: Block) => b.season ?? parent(episodeOf(b), 'drama/season');
  const set = (v: unknown) => (v && v !== 'inherit' ? String(v) : '');
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
  const styleOf = (b: Block) => oneLine(String(episodeOf(b)?.params.style ?? '') || String(seasonOf(b)?.params.style ?? '') || opts.style || DEFAULT_STYLE);
  const aspectOf = (b: Block) => set(episodeOf(b)?.params.aspect) || set(seasonOf(b)?.params.aspect) || opts.aspect || '16:9';
  const maxClipOf = (b: Block) => Math.max(minClip, num(episodeOf(b)?.params.maxClip) || num(seasonOf(b)?.params.maxClip) || opts.maxClip || 15);
  const maxImagesOf = (b: Block) => Math.max(1, Math.round(num(episodeOf(b)?.params.maxImages) || num(seasonOf(b)?.params.maxImages) || opts.maxImages || 9));
  const clipRange = new Set<number>();

  // ---- generations
  const generations: SeedanceGeneration[] = [];
  const genMd = new Map<Block, string[]>();
  for (const b of blocks) {
    const s = b.scene;
    const ep = b.episode ? `e${b.episode.number}-` : '';
    const parts: string[] = [];
    const maxClip = maxClipOf(b);
    const maxImages = maxImagesOf(b);
    clipRange.add(maxClip);
    const runs = clips(s.shots, maxClip);
    runs.forEach((run, ri) => {
      const refs: SeedanceAsset[] = [];
      const dropped: SeedanceAsset[] = [];
      const add = (a: SeedanceAsset | undefined) => {
        if (!a || refs.includes(a)) return;
        if (refs.length < maxImages) refs.push(a);
        else if (!dropped.includes(a)) dropped.push(a);
      };
      const people = [...new Map(run.flatMap((x) => x.characters).map((c) => [c.id, c])).values()];
      const where = [...new Map(run.map((x) => x.location).filter((l): l is NodeInstance => !!l).map((l) => [l.id, l])).values()];
      const things = [...new Map(run.flatMap((x) => x.props).map((p) => [p.id, p])).values()];
      // Identity first (faces, places), then composition (storyboard frames), then extras.
      people.forEach((c) => add(castImages.get(c.id)?.[0]));
      where.forEach((l) => add(placeImages.get(l.id)?.[0]));
      things.forEach((p) => add(propImages.get(p.id)?.[0]));
      const frameOf = new Map<ShotInfo, SeedanceAsset>();
      for (const x of run) {
        const f = x.images[0] ? asset(x.images[0], 'shots', `${ep}s${s.number}-shot${x.number}`, `Scene ${s.number} shot ${x.number} frame`) : undefined;
        if (f) {
          add(f);
          if (refs.includes(f)) frameOf.set(x, f);
        }
      }
      imageList(s.node.params.storyboard).forEach((src) => add(asset(src, 'scenes', `${ep}s${s.number}-storyboard`, `Scene ${s.number} storyboard`)));
      where.forEach((l) => placeImages.get(l.id)?.slice(1).forEach(add));

      const ref = (a: SeedanceAsset | undefined) => (a && refs.includes(a) ? `@Image${refs.indexOf(a) + 1}` : '');
      const lines: string[] = [];
      lines.push(`${sentence(styleOf(b))} Aspect ratio ${aspectOf(b)}.`);
      const who = people.map((c) => {
        const r = ref(castImages.get(c.id)?.[0]);
        const d = oneLine(String(c.params.description ?? '')).split(/(?<=[.!?])\s/)[0];
        return `${dramaName(c)}${r ? ` is ${r}` : ''}${d ? ` (${d.replace(/[.!?]$/, '')})` : ''}`;
      });
      if (who.length) lines.push(`Characters: ${who.join('; ')}.`);
      if (where.length) {
        const w = where.map((l) => {
          const r = ref(placeImages.get(l.id)?.[0]);
          const d = oneLine(String(l.params.description ?? ''));
          return `${dramaName(l)}${r ? ` (${r})` : ''}, ${l.params.setting === 'EXT' ? 'exterior' : 'interior'}, ${TIME[s.time] ?? s.time.toLowerCase()}${d ? `. ${sentence(d)}` : '.'}`;
        });
        lines.push(`Setting: ${w.join(' ')}`.replace(/\.\.$/, '.'));
      }
      if (things.length) lines.push(`Props: ${things.map((p) => `${dramaName(p)}${ref(propImages.get(p.id)?.[0]) ? ` (${ref(propImages.get(p.id)?.[0])})` : ''}`).join(', ')}.`);
      if (s.description && ri === 0) lines.push(`Scene: ${sentence(s.description)}`);
      lines.push('');
      let t = 0;
      const total = Math.min(maxClip, Math.max(minClip, run.reduce((a, x) => a + Math.max(1, x.duration), 0)));
      run.forEach((x, i) => {
        const d = Math.max(1, x.duration);
        const end = i === run.length - 1 ? total : Math.min(total, t + d);
        const parts = [`${FRAMING[x.framing] ?? x.framing}, ${MOVE[x.movement] ?? x.movement.toLowerCase()}.`];
        if (x.characters.length) parts.push(`On screen: ${and(x.characters.map(dramaName))}.`);
        if (x.description) parts.push(sentence(x.description));
        const f = ref(frameOf.get(x));
        if (f) parts.push(`Match the composition of ${f}.`);
        lines.push(`Shot ${i + 1} (${Math.round(t)}–${Math.round(end)} s): ${parts.join(' ')}`);
        t = end;
      });
      lines.push('');
      lines.push(
        `Keep every character's face, hair and clothes consistent with their reference image${people.length === 1 ? '' : 's'}. Hard cuts between shots. No subtitles, captions or on-screen text.`,
      );
      const longShot = run.length === 1 && run[0].duration > maxClip;
      const shotRange = run.length === 1 ? `shot ${run[0].number}` : `shots ${run[0].number}–${run[run.length - 1].number}`;
      const title = `${b.episode ? `Ep ${b.episode.number} · ` : ''}Scene ${s.number} · ${shotRange}`;
      const gen = { title, duration: total, refs, prompt: lines.join('\n') };
      generations.push(gen);

      const md: string[] = [];
      md.push(`#### Generation ${generations.length}: ${mdEsc(title)} · ${total} s`);
      md.push('');
      if (longShot) md.push(`> Shot ${run[0].number} is ${run[0].duration} s; Seedance clips stop at ${maxClip} s, so it is cut to ${maxClip} s here. Extend it in a second generation if you need the rest.\n`);
      if (refs.length) {
        md.push('Upload these images in this order:');
        md.push('');
        md.push('| Reference | Image | Shows |');
        md.push('| --- | --- | --- |');
        refs.forEach((a, i) => md.push(`| @Image${i + 1} | ![${mdEsc(a.label)}](${a.path}) \`${a.path}\` | ${mdEsc(a.label)} |`));
        md.push('');
      } else md.push('No reference images: add pictures to the characters, locations or shots to keep them consistent.\n');
      if (dropped.length) md.push(`> Left out (this script allows ${maxImages} images per generation; raise “reference images” on the episode or season for more): ${dropped.map((a) => `\`${a.path}\``).join(', ')}\n`);
      md.push('```text');
      md.push(gen.prompt);
      md.push('```');
      parts.push(md.join('\n'));
    });
    if (!runs.length) parts.push('_No shots yet._');
    genMd.set(b, parts);
  }

  // ---- markdown
  const md: string[] = [];
  md.push(`# ${mdEsc(sc.title)}: Seedance script`);
  md.push('');
  const totalTime = generations.reduce((t, g) => t + g.duration, 0);
  md.push(`${generations.length} generation${generations.length === 1 ? '' : 's'} · ${Math.floor(totalTime / 60)}:${String(totalTime % 60).padStart(2, '0')} of video · ${bySrc.size} reference image${bySrc.size === 1 ? '' : 's'}`);
  md.push('');
  md.push(
    `**How to use.** Each generation is one Seedance clip (${minClip}–${clipRange.size ? Math.max(...clipRange) : (opts.maxClip ?? 15)} s). Upload its images in the order listed, so they become @Image1, @Image2 and so on, set the duration, and paste its prompt. Images are in the \`assets/\` folder next to this file. Join the clips in order.`,
  );
  md.push('');

  const sheet = (title: string, nodes: NodeInstance[], imgs: Map<string, SeedanceAsset[]>, extra: (n: NodeInstance) => string) => {
    if (!nodes.length) return;
    md.push(`## ${title}`);
    md.push('');
    for (const n of nodes) {
      md.push(`### ${mdEsc(dramaName(n))}`);
      md.push('');
      const e = extra(n);
      if (e) md.push(e, '');
      const d = String(n.params.description ?? '').trim();
      if (d) md.push(mdEsc(d), '');
      const list = imgs.get(n.id) ?? [];
      if (list.length) md.push(list.map((a) => `![${mdEsc(a.label)}](${a.path})`).join(' '), '');
    }
  };
  sheet('Characters', [...cast.values()], castImages, (c) => (c.params.actor ? `_Played by ${mdEsc(String(c.params.actor))}_` : ''));
  sheet('Locations', [...places.values()], placeImages, (l) => `_${l.params.setting === 'EXT' ? 'Exterior' : 'Interior'}_`);
  sheet('Props', [...props.values()], propImages, () => '');

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
    md.push(`### Scene ${s.number}. ${mdEsc(s.slug)}`);
    md.push('');
    if (s.description) md.push(mdEsc(s.description), '');
    md.push(...genMd.get(b)!.flatMap((p) => [p, '']));
  }
  if (!blocks.length) md.push('_Nothing to film yet: wire shots into scenes._', '');

  return { title: sc.title, markdown: md.join('\n').replace(/\n{3,}/g, '\n\n'), assets: [...bySrc.values()], generations };
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

/** Draw an SVG to a PNG (Seedance wants raster images). Undefined where there is no canvas. */
async function rasterize(svgSrc: string, width = 1280): Promise<Uint8Array | undefined> {
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
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The asset pack: `script.md` plus every reference image at the path the script uses. SVG
 * images are rasterised to PNG; web images are fetched (an image the browser can't fetch is
 * linked by URL in the script instead).
 */
export async function seedancePack(graph: Graph, id?: string, opts: SeedanceOptions = {}): Promise<{ filename: string; blob: Blob; script: SeedanceScript }> {
  const script = seedanceScript(graph, id, opts);
  let markdown = script.markdown;
  const files: { path: string; data: Uint8Array }[] = [];
  for (const a of script.assets) {
    let bytes: Uint8Array | undefined;
    let path = a.path;
    const d = a.src.startsWith('data:') ? dataUrlBytes(a.src) : undefined;
    if (d && /svg/i.test(d.type)) {
      bytes = await rasterize(a.src);
      if (!bytes) {
        bytes = d.bytes;
        path = a.path.replace(/\.png$/, '.svg');
      }
    } else if (d) bytes = d.bytes;
    else {
      try {
        const res = await fetch(a.src);
        if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
      } catch {
        /* cross-origin or offline: link it instead */
      }
    }
    if (!bytes) {
      markdown = markdown.split(a.path).join(a.src);
      continue;
    }
    if (path !== a.path) markdown = markdown.split(a.path).join(path);
    files.push({ path, data: bytes });
  }
  files.unshift({ path: 'script.md', data: new TextEncoder().encode(markdown) });
  const data = zip(files);
  return { filename: `${slug(script.title)}-seedance.zip`, blob: new Blob([data.buffer as ArrayBuffer], { type: 'application/zip' }), script: { ...script, markdown } };
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
