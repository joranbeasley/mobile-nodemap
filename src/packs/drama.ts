import { defineNode, definePack, type GraphEngine } from '../core/registry.js';
import type { Graph } from '../core/graph.js';
import type { NodeInstance, NodeResult, NodeType, ParamKind, PortTypeDef } from '../core/types.js';
import { saveDramaFile, seedancePack, seedanceScript } from './drama-seedance.js';

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
    const draw = () => {
      wrap.replaceChildren();
      list.forEach((src, i) => {
        const t = document.createElement('span');
        t.className = 'dr-thumb';
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'dr-view';
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
      if (list.length < max) {
        const add = document.createElement('label');
        add.className = 'dr-add';
        add.append(list.length ? '+' : '+ Add images', file);
        wrap.append(add);
      }
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

const description = (advanced = false, placeholder = '') => ({ name: 'description', label: 'description', kind: 'text' as const, multiline: true, default: '', placeholder, advanced });
const images = (name = 'images', label = 'images', advanced = false) => ({ name, label, kind: 'images', default: [], advanced });
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
  params: [description(false, 'What it is'), images('images', 'images', true)],
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
  description: 'What a character wears in the scenes it is wired into',
  inputs: { character: { type: DRAMA.character, label: 'character', description: 'Who wears it' } },
  outputs: { scenes: { type: DRAMA.costume, label: 'in scenes' } },
  params: [description(false, 'What they wear: garments, colours, accessories'), images()],
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
  },
  outputs: { scene: { type: DRAMA.shot, label: 'scene' } },
  caption: (n) => `Shot ${String(n.params.number ?? '').trim() || '?'} · ${n.params.framing ?? 'Medium'}`,
  params: [
    { name: 'number', label: 'shot', kind: 'text', default: '1', placeholder: '1, 2, 2A…' },
    { name: 'framing', label: 'framing', kind: 'select', options: FRAMINGS, default: 'Medium' },
    description(false, 'What we see and hear'),
    images('images', 'frames'),
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

/** The costume each character wears in a scene (the first wired in, if there are two). */
export function sceneCostumes(graph: Graph, sceneId: string): Map<string, NodeInstance> {
  const out = new Map<string, NodeInstance>();
  for (const c of from(graph, sceneId, 'costumes')) {
    const who = from(graph, c.id, 'character')[0];
    if (who && !out.has(who.id)) out.set(who.id, c);
  }
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
  paramKinds: [imagesParam],
  nodes,
  css,
});
