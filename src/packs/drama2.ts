import { defineNode, definePack, type GraphEngine } from '../core/registry.js';
import { Graph } from '../core/graph.js';
import type { GraphJSON, NodeInstance, NodeResult, NodeType, ParamKind } from '../core/types.js';
import { DRAMA_DETAILS, SHOT_CLIP_PARAMS, clipFrameParam, dramaImagePrompt, FRAMINGS, MOVES, TIMES, appearances, dramaEngine, dramaPack, dramaView, imagesParam, sceneInfo, episodeInfo } from './drama.js';

/**
 * Drama 2: the same production model as the drama graph type, edited as boards instead of
 * wires. Nodes have no ports; they refer to each other through `ref` / `refs` params (a shot's
 * location, characters and props, a scene's shots, an episode's scenes, who wears an outfit).
 * Outfits are props whose type is Outfit. `toDrama()` turns a board into a wired drama graph, so the drama engine, shot
 * lists and Seedance export all work on it unchanged.
 */

export const D2 = {
  character: 'drama2/character',
  prop: 'drama2/prop',
  location: 'drama2/location',
  shot: 'drama2/shot',
  scene: 'drama2/scene',
  episode: 'drama2/episode',
} as const;

// ------------------------------------------------------------------ references

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : typeof v === 'string' && v ? [v] : []);

/** What a node is called on screen: its name, its type's caption, or the type's title. */
export function nodeTitle(graph: Graph, n: NodeInstance): string {
  const def = graph.registry?.get(n.type);
  if (n.label) return n.label;
  try {
    return def?.caption?.(n) || def?.title || n.type;
  } catch {
    return def?.title ?? n.type;
  }
}

/** Nodes of `type` that `n` refers to through `param` (missing ones skipped). */
export const refsOf = (graph: Graph, n: NodeInstance | undefined, param: string): NodeInstance[] =>
  n ? idList(n.params[param]).map((id) => graph.nodes.get(id)).filter((x): x is NodeInstance => !!x) : [];

/** Nodes that refer to `id` through `param`, e.g. the scene whose `shots` hold a shot. */
export const referrers = (graph: Graph, id: string, type: string, param: string): NodeInstance[] =>
  [...graph.nodes.values()].filter((n) => n.type === type && idList(n.params[param]).includes(id));

/**
 * Who wears an outfit in a shot. Any character can wear any outfit: the shot's choice
 * (`wearers`, outfit id → character id) if that character is in the shot; else the outfit's
 * usual wearer if they are; else the shot's only character. Undefined when it isn't clear.
 */
export function wearerOf(graph: Graph, shot: NodeInstance, outfit: NodeInstance): NodeInstance | undefined {
  const cast = refsOf(graph, shot, 'characters');
  const chosen = (shot.params.wearers as Record<string, string> | undefined)?.[outfit.id];
  return cast.find((c) => c.id === chosen) ?? cast.find((c) => c.id === idList(outfit.params.wornBy)[0]) ?? (cast.length === 1 ? cast[0] : undefined);
}

// ------------------------------------------------------------------ wardrobe

/** Who wears what: character id → outfit id, or '' for their usual clothes. On episodes, scenes and shots. */
export type Wardrobe = Record<string, string>;
const wardrobeOf = (n?: NodeInstance): Wardrobe => (n && n.params.wardrobe && typeof n.params.wardrobe === 'object' ? (n.params.wardrobe as Wardrobe) : {});
const owns = (w: Wardrobe, k: string) => Object.prototype.hasOwnProperty.call(w, k);
export const sceneOfShot = (graph: Graph, shotId: string) => referrers(graph, shotId, D2.scene, 'shots')[0];
export const episodeOfScene = (graph: Graph, sceneId: string) => referrers(graph, sceneId, D2.episode, 'scenes')[0];

/** What a character wears somewhere, and which level said so ('none': nobody did: usual clothes). */
export interface Dress {
  outfit?: NodeInstance;
  from: 'shot' | 'scene' | 'episode' | 'none';
}

/**
 * What a character wears in a shot, scene or episode. An outfit set on an episode dresses them in
 * all its scenes and shots, one set on a scene overrides that for the scene's shots, and one set
 * on a shot overrides both; each level can also say "usual clothes". (An outfit put in a shot's
 * props, as boards used to, counts as set on that shot.)
 */
export function dressOf(graph: Graph, node: NodeInstance, characterId: string): Dress {
  const levels: [NodeInstance | undefined, Dress['from']][] = [];
  if (node.type === D2.shot) {
    const sc = sceneOfShot(graph, node.id);
    levels.push([node, 'shot'], [sc, 'scene'], [sc && episodeOfScene(graph, sc.id), 'episode']);
  } else if (node.type === D2.scene) levels.push([node, 'scene'], [episodeOfScene(graph, node.id), 'episode']);
  else if (node.type === D2.episode) levels.push([node, 'episode']);
  for (const [n, from] of levels) {
    if (!n) continue;
    const w = wardrobeOf(n);
    if (owns(w, characterId)) {
      const o = graph.nodes.get(w[characterId]);
      return { outfit: isOutfit(o) ? o : undefined, from };
    }
    if (from === 'shot') {
      const legacy = refsOf(graph, n, 'props').find((o) => isOutfit(o) && wearerOf(graph, n, o)?.id === characterId);
      if (legacy) return { outfit: legacy, from };
    }
  }
  return { from: 'none' };
}

/** The characters a wardrobe applies to: a shot's, everyone in a scene's shots, everyone in an episode. */
export function castOf(graph: Graph, node: NodeInstance): NodeInstance[] {
  if (node.type === D2.shot) return refsOf(graph, node, 'characters');
  if (node.type === D2.scene) return [...new Set(refsOf(graph, node, 'shots').flatMap((s) => castOf(graph, s)))];
  if (node.type === D2.episode) return [...new Set(refsOf(graph, node, 'scenes').flatMap((sc) => castOf(graph, sc)))];
  return [];
}

/** Every outfit a character wears: their usual ones, and any they end up in on a shot (set there, on its scene or its episode). */
export function outfitsOf(graph: Graph, characterId: string): NodeInstance[] {
  const usual = referrers(graph, characterId, D2.prop, 'wornBy').filter(isOutfit);
  const worn = [...graph.nodes.values()]
    .filter((n) => n.type === D2.shot && castOf(graph, n).some((c) => c.id === characterId))
    .map((n) => dressOf(graph, n, characterId).outfit)
    .filter((o): o is NodeInstance => !!o);
  return [...new Set([...usual, ...worn])];
}

const INHERIT = '\u0000inherit';
const NEW_OUTFIT = '\u0000new';

/**
 * The wardrobe of an episode, scene or shot: a row per character there, each with what they
 * wear. "From scene" (or episode) keeps what the level above says; or pick an outfit, or
 * their usual clothes, to override it here and below.
 */
export const wardrobeParam: ParamKind = {
  kind: 'wardrobe',
  render(ctx) {
    const graph = ctx.graph;
    const wrap = document.createElement('div');
    wrap.className = 'dr2-wardrobe';
    const parentOf = (n: NodeInstance): [NodeInstance | undefined, string] =>
      n.type === D2.shot ? [sceneOfShot(graph, n.id), 'scene'] : n.type === D2.scene ? [episodeOfScene(graph, n.id), 'episode'] : [undefined, ''];
    const draw = () => {
      wrap.textContent = '';
      const node = graph.nodes.get(ctx.node.id);
      if (!node) return;
      const cast = castOf(graph, node);
      if (!cast.length) {
        wrap.append(Object.assign(document.createElement('small'), { className: 'dr2-wardrobe-empty', textContent: node.type === D2.shot ? 'Add characters to dress them.' : 'Add shots with characters to dress them.' }));
        return;
      }
      const own = wardrobeOf(node);
      const outfits = [...graph.nodes.values()].filter(isOutfit);
      const [parent, parentKind] = parentOf(node);
      for (const c of cast) {
        const row = document.createElement('label');
        row.className = 'dr2-wardrobe-row';
        const name = Object.assign(document.createElement('span'), { textContent: nodeTitle(graph, c) });
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', `What ${nodeTitle(graph, c)} wears`);
        const option = (text: string, v: string) => Object.assign(document.createElement('option'), { textContent: text, value: v });
        const above = parent ? dressOf(graph, parent, c.id) : ({ from: 'none' } as Dress);
        sel.append(option(above.outfit ? `${nodeTitle(graph, above.outfit)} (from ${parentKind})` : parentKind ? `Usual clothes (from ${parentKind})` : 'Usual clothes', INHERIT));
        if (above.outfit) sel.append(option('Usual clothes', ''));
        // Their usual outfits first, then everyone else's.
        const mine = (o: NodeInstance) => idList(o.params.wornBy)[0] === c.id;
        for (const o of [...outfits.filter(mine), ...outfits.filter((o) => !mine(o))]) {
          const usual = refsOf(graph, o, 'wornBy')[0];
          sel.append(option(`${nodeTitle(graph, o)}${usual && usual.id !== c.id ? ` (${nodeTitle(graph, usual)}’s)` : ''}`, o.id));
        }
        sel.append(option('+ New outfit…', NEW_OUTFIT));
        // What shows: this level's own choice (or an outfit in the shot's props), else "as above".
        const level = node.type === D2.shot ? 'shot' : node.type === D2.scene ? 'scene' : 'episode';
        const here = dressOf(graph, node, c.id);
        sel.value = owns(own, c.id) ? (own[c.id] && graph.nodes.has(own[c.id]) ? own[c.id] : above.outfit ? '' : INHERIT) : here.from === level && here.outfit ? here.outfit.id : INHERIT;
        sel.addEventListener('change', () => {
          const next = { ...wardrobeOf(graph.nodes.get(node.id)) };
          let v = sel.value;
          if (v === NEW_OUTFIT) {
            const o = graph.addNode(D2.prop);
            graph.setParam(o.id, 'kind', 'Outfit');
            graph.setParam(o.id, 'wornBy', c.id);
            graph.setLabel?.(o.id, `${nodeTitle(graph, c)}’s outfit`);
            v = o.id;
          }
          if (v === INHERIT) delete next[c.id];
          else next[c.id] = v;
          ctx.set(next);
        });
        row.append(name, sel);
        wrap.append(row);
      }
    };
    const off = graph.on('change', (c) => {
      if (!wrap.isConnected) return void (wrap.dataset.mounted && off());
      wrap.dataset.mounted = '1';
      if (c.kind === 'node:move' || wrap.contains(document.activeElement)) return;
      draw();
    });
    draw();
    return wrap;
  },
  update() {},
};

type RefParam = {
  name: string;
  label?: string;
  of: string;
  /** A node can be held by only one node through this param (a shot belongs to one scene). */
  exclusive?: boolean;
  /** Use the searchable chooser past this many choices. Default 8. */
  searchAbove?: number;
  /** Offer "+ New …", which creates a node of type `of` and adds it. */
  create?: boolean;
  /** With exclusive: also offer nodes other nodes hold; picking one moves it here. */
  movable?: boolean;
  /** ‹ › buttons on the chips to reorder them. */
  sortable?: boolean;
  /** Keep this param of the listed nodes in step with the order: 1, 2, 3… */
  renumber?: string;
  /** Which nodes the picker offers (others already listed still show). */
  only?: (n: NodeInstance) => boolean;
  /** Something extra on a chip (who wears an outfit in this shot). */
  chip?: (graph: Graph, holder: NodeInstance, item: NodeInstance) => HTMLElement | undefined;
};
const NEW = '\u0000new';
const MOVE = '\u0000move:';

/** A second line for a node in a picker, to tell similar names apart. */
function refHint(graph: Graph, n: NodeInstance): string {
  const p = n.params;
  const words = (v: unknown, k = 8) => String(v ?? '').replace(/\s+/g, ' ').trim().split(' ').slice(0, k).join(' ');
  switch (n.type) {
    case D2.character:
      return [p.actor ? `played by ${p.actor}` : '', words(p.description)].filter(Boolean).join(' · ');
    case D2.location:
      return [p.setting === 'EXT' ? 'Exterior' : 'Interior', words(p.description)].filter(Boolean).join(' · ');
    case D2.prop: {
      const who = p.kind === 'Outfit' ? refsOf(graph, n, 'wornBy')[0] : undefined;
      return [p.kind === 'Outfit' ? `Outfit${who ? `, usually ${nodeTitle(graph, who)}` : ''}` : 'Object', words(p.description, 6)].filter(Boolean).join(' · ');
    }
    case D2.shot: {
      const sc = referrers(graph, n.id, D2.scene, 'shots')[0];
      const ep = sc && referrers(graph, sc.id, D2.episode, 'scenes')[0];
      return [ep ? `Ep ${Number(ep.params.number ?? 1)}` : '', sc ? nodeTitle(graph, sc) : 'not in a scene', words(p.description, 6)].filter(Boolean).join(' · ');
    }
    case D2.scene: {
      const ep = referrers(graph, n.id, D2.episode, 'scenes')[0];
      return [ep ? `Episode ${Number(ep.params.number ?? 1)}: ${nodeTitle(graph, ep)}` : 'not in an episode', words(p.description, 6)].filter(Boolean).join(' · ');
    }
    default:
      return words(p.description);
  }
}

/**
 * A control for references to other nodes: a chip per node (tap to jump to it, × to remove)
 * and a picker to add one. `kind: 'ref'` holds one id, `kind: 'refs'` a list. With
 * `exclusive`, a node can only be referred to by one node through this param (a shot
 * belongs to one scene), so the picker offers only free ones.
 *
 *   { name: 'characters', kind: 'refs', of: 'drama2/character' }
 */
function refControl(single: boolean): ParamKind {
  return {
    kind: single ? 'ref' : 'refs',
    render(ctx) {
      const p = ctx.param as unknown as RefParam;
      const graph = ctx.graph;
      const wrap = document.createElement('div');
      wrap.className = 'dr2-refs';
      let value = idList(ctx.value);
      // With `renumber`, the list order is the numbering: positions become numbers 1, 2, 3…
      const renumber = (ids: string[]) => {
        if (!p.renumber) return;
        ids.forEach((id, i) => {
          const n = graph.nodes.get(id);
          if (!n) return;
          const cur = n.params[p.renumber!];
          const next = typeof cur === 'number' ? i + 1 : String(i + 1);
          if (cur !== next) graph.setParam(id, p.renumber!, next);
        });
      };
      const commit = (next: string[]) => {
        value = next;
        ctx.set(single ? next[0] ?? '' : next);
        renumber(next);
        draw();
      };
      // The other node (of this node's type) that holds `id` through this param, for exclusive refs.
      const holderOf = (id: string) =>
        [...graph.nodes.values()].find((x) => x.type === ctx.node.type && x.id !== ctx.node.id && idList(x.params[p.name]).includes(id));
      /** Add an id: a new node, a free one, or (movable) one taken from another holder. */
      const add = (choice: string) => {
        let id = choice;
        if (choice === NEW) id = graph.addNode(p.of).id;
        else if (choice.startsWith(MOVE)) {
          id = choice.slice(MOVE.length);
          const holder = holderOf(id);
          if (holder) {
            const rest = idList(holder.params[p.name]).filter((x) => x !== id);
            graph.setParam(holder.id, p.name, rest);
            renumber(rest);
          }
        }
        commit(single ? [id] : [...value, id]);
      };
      const typeTitle = (graph.registry?.get(p.of)?.title ?? 'item').toLowerCase();
      const button = (cls: string, text: string, aria: string, fn: () => void, disabled = false) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = text;
        b.setAttribute('aria-label', aria);
        b.disabled = disabled;
        b.addEventListener('click', fn);
        return b;
      };
      const draw = () => {
        wrap.textContent = '';
        const shown = value.filter((id) => graph.nodes.has(id));
        shown.forEach((id, i) => {
          const n = graph.nodes.get(id)!;
          const name = nodeTitle(graph, n);
          const chip = document.createElement('span');
          chip.className = 'dr2-chip';
          const open = button('', name, `Open ${name}`, () => {});
          open.dataset.nmOpen = id;
          open.title = `Open ${name}`;
          const move = (d: number) => () => {
            const next = [...shown];
            [next[i], next[i + d]] = [next[i + d], next[i]];
            commit(next);
          };
          if (p.sortable && shown.length > 1) chip.append(button('dr2-mv', '‹', `Move ${name} earlier`, move(-1), i === 0));
          chip.append(open);
          if (p.sortable && shown.length > 1) chip.append(button('dr2-mv', '›', `Move ${name} later`, move(1), i === shown.length - 1));
          const extra = p.chip?.(graph, ctx.node, n);
          if (extra) chip.append(extra);
          chip.append(button('dr2-x', '×', `Remove ${name}`, () => commit(value.filter((x) => x !== id))));
          wrap.append(chip);
        });
        // What can be added: free nodes, and (movable) ones another node holds.
        const free: NodeInstance[] = [];
        const taken: { n: NodeInstance; holder: NodeInstance }[] = [];
        for (const x of graph.nodes.values()) {
          if (x.type !== p.of || value.includes(x.id) || (p.only && !p.only(x))) continue;
          const holder = p.exclusive ? holderOf(x.id) : undefined;
          if (!holder) free.push(x);
          else if (p.movable) taken.push({ n: x, holder });
        }
        if (!free.length && !taken.length && !p.create && (!single || value.length)) return;
        const label = single && value.length ? 'Change…' : `+ ${typeTitle}…`;
        const aria = single && value.length ? `Change ${p.label ?? p.name}` : `Add ${typeTitle}`;
        const choices = [
          ...(p.create ? [{ id: NEW, label: `+ New ${typeTitle}`, hint: 'Create one here' }] : []),
          ...free.map((x) => ({ id: x.id, label: nodeTitle(graph, x), hint: refHint(graph, x) })),
          ...taken.map(({ n, holder }) => ({ id: MOVE + n.id, label: `${nodeTitle(graph, n)} (in ${nodeTitle(graph, holder)})`, hint: `Moves it from ${nodeTitle(graph, holder)}` })),
        ];
        // Long lists get a searchable sheet instead of a plain select.
        if (ctx.choose && free.length + taken.length > (p.searchAbove ?? 8)) {
          const btn = button('dr2-pick dr2-search', label, aria, async () => {
            const id = await ctx.choose!({ title: aria, placeholder: `Search ${free.length + taken.length} ${typeTitle}s`, items: choices });
            if (id) add(id);
          });
          wrap.append(btn);
          return;
        }
        const pick = document.createElement('select');
        pick.className = 'dr2-pick';
        pick.setAttribute('aria-label', aria);
        const option = (text: string, v: string) => Object.assign(document.createElement('option'), { textContent: text, value: v });
        pick.append(option(label, ''));
        for (const c of choices) pick.append(option(c.label, c.id));
        if (!choices.length) pick.disabled = true;
        pick.addEventListener('change', () => {
          if (pick.value) add(pick.value);
        });
        wrap.append(pick);
      };
      // Names change elsewhere (renames, new nodes): keep the chips and the picker current.
      const off = graph.on('change', (c) => {
        if (!wrap.isConnected) return void (wrap.dataset.mounted && off());
        wrap.dataset.mounted = '1';
        if (c.kind === 'node:move') return;
        if (wrap.contains(document.activeElement)) return;
        if (c.kind === 'node:params' && c.node.id === ctx.node.id && c.name === p.name) value = idList(c.node.params[p.name]);
        draw();
      });
      draw();
      return wrap;
    },
    update(el, v) {
      void el;
      void v;
    },
  };
}

export const refParam = refControl(true);
export const refsParam = refControl(false);

// ------------------------------------------------------------------ nodes

const text = (name: string, label: string, placeholder = '', advanced = false, description?: string) => ({
  name,
  label,
  kind: 'text' as const,
  multiline: true,
  default: '',
  placeholder,
  advanced,
  ...(description ? { description } : {}),
});
const images = (name = 'images', label = 'images', advanced = false) => ({
  name,
  label,
  kind: 'images',
  default: [],
  advanced,
  // ✨ Generate suggestions come from the drama model (same ids after toDrama).
  prompt: (node: NodeInstance, graph: Graph) => {
    const wired = toDrama(graph);
    const w = wired.nodes.get(node.id);
    return w ? dramaImagePrompt(wired, w, name) : undefined;
  },
});
const ref = (name: string, label: string, of: string) => ({ name, label, kind: 'ref', of, default: '' });
const refs = (name: string, label: string, of: string, exclusive = false) => ({ name, label, kind: 'refs', of, exclusive, default: [] });
const number = () => ({ name: 'number', label: 'number', kind: 'number' as const, default: 1, min: 1, step: 1 });
const wardrobe = (description: string) => ({ name: 'wardrobe', label: 'wardrobe', kind: 'wardrobe', default: {}, description });

const characterNode = defineNode({
  type: D2.character,
  title: 'Character',
  category: 'Cast',
  color: '#e8590c',
  icon: '☺',
  flavor: 'source',
  width: 250,
  description: 'Someone in the story: name, description, appearance, pictures',
  params: [
    text('description', 'description', 'Who they are'),
    text('appearance', 'appearance', 'Age, build, hair, face, usual clothes', false, 'Repeated word for word in every video prompt they are in'),
    images(),
    { name: 'actor', label: 'played by', kind: 'text', default: '', placeholder: 'Cast member', advanced: true },
  ],
  onCreate: (n) => void (n.label ??= 'New character'),
});

export const PROP_TYPES = ['Object', 'Outfit'];
const isOutfit = (n: NodeInstance | undefined) => n?.type === D2.prop && n.params.kind === 'Outfit';

const propNode = defineNode({
  type: D2.prop,
  title: 'Prop',
  category: 'Props',
  color: '#ae3ec9',
  icon: '✦',
  flavor: 'source',
  width: 250,
  tags: ['outfit', 'costume', 'object', 'wardrobe', 'item'],
  description: 'An object or an outfit that shots need',
  params: [
    { name: 'kind', label: 'type', kind: 'select', options: PROP_TYPES, default: 'Object' },
    {
      ...ref('wornBy', 'usually worn by', D2.character),
      description: 'Optional. Anyone can wear it: in each shot, pick who wears it next to the outfit. There it replaces their usual clothes.',
      when: (p: Record<string, unknown>) => p.kind === 'Outfit',
    },
    text('description', 'description', 'What it is: material, colour, details'),
    { ...images(), browse: true },
  ],
  onCreate: (n) => void (n.label ??= 'New prop'),
});

const locationNode = defineNode({
  type: D2.location,
  title: 'Location',
  category: 'Places',
  color: '#2f9e44',
  icon: '⌂',
  flavor: 'source',
  width: 250,
  description: 'Where shots happen: name, setting, description, pictures',
  params: [{ name: 'setting', label: 'setting', kind: 'select', options: ['INT', 'EXT'], default: 'INT' }, text('description', 'description', 'What it looks like'), images()],
  onCreate: (n) => void (n.label ??= 'New location'),
});

/** On an outfit's chip in a shot: who wears it here, from the shot's characters. */
function wearerPicker(graph: Graph, shot: NodeInstance, item: NodeInstance): HTMLElement | undefined {
  if (!isOutfit(item)) return undefined;
  const cast = refsOf(graph, shot, 'characters');
  const sel = document.createElement('select');
  sel.className = 'dr2-wearer';
  sel.setAttribute('aria-label', `Who wears ${nodeTitle(graph, item)} in this shot`);
  const who = wearerOf(graph, shot, item);
  const option = (text: string, v: string) => Object.assign(document.createElement('option'), { textContent: text, value: v });
  if (!who) sel.append(option(cast.length ? 'on: who?' : 'on: add a character', ''));
  for (const c of cast) sel.append(option(`on ${nodeTitle(graph, c)}`, c.id));
  sel.value = who?.id ?? '';
  sel.disabled = !cast.length;
  sel.addEventListener('change', () => {
    const wearers = { ...((shot.params.wearers as Record<string, string> | undefined) ?? {}) };
    if (sel.value) wearers[item.id] = sel.value;
    else delete wearers[item.id];
    graph.setParam(shot.id, 'wearers', wearers);
  });
  return sel;
}

const shotNode = defineNode({
  type: D2.shot,
  title: 'Shot',
  category: 'Story',
  color: '#1971c2',
  icon: '▣',
  flavor: 'transform',
  width: 260,
  description: 'One camera set-up: one location, any characters',
  caption: (n) => `Shot ${String(n.params.number ?? '').trim() || '?'} · ${n.params.framing ?? 'Medium'}`,
  params: [
    { name: 'number', label: 'shot', kind: 'text', default: '1', placeholder: '1, 2, 2A…' },
    { name: 'framing', label: 'framing', kind: 'select', options: FRAMINGS, default: 'Medium' },
    { ...ref('location', 'location', D2.location), create: true },
    { ...refs('characters', 'characters', D2.character), create: true },
    { ...refs('props', 'props', D2.prop), create: true, chip: wearerPicker, only: (n: NodeInstance) => !isOutfit(n) },
    wardrobe('What each character wears in this shot. Leave it "from scene" to keep what the scene (or episode) says.'),
    text('description', 'description', 'What we see and hear'),
    images('images', 'frames'),
    ...SHOT_CLIP_PARAMS,
    { name: 'movement', label: 'camera', kind: 'select', options: MOVES, default: 'Static', advanced: true },
    { name: 'duration', label: 'seconds', kind: 'number', default: 5, min: 0, step: 1, advanced: true },
  ],
});

const sceneNode = defineNode({
  type: D2.scene,
  title: 'Scene',
  category: 'Story',
  color: '#5f3dc4',
  icon: '❏',
  flavor: 'transform',
  width: 440,
  description: 'A numbered scene: a set of shots',
  caption: (n) => `Scene ${Number(n.params.number ?? 1)} · ${n.params.time ?? 'DAY'}`,
  params: [
    number(),
    { name: 'time', label: 'time', kind: 'select', options: TIMES, default: 'DAY' },
    { ...refs('shots', 'shots', D2.shot, true), create: true, movable: true, sortable: true, renumber: 'number' },
    text('description', 'description', 'What happens'),
    wardrobe('What each character wears in this scene, for all its shots (a shot can still change it).'),
    images('storyboard', 'storyboard', true),
  ],
});

const look = [
  text('style', 'video style', 'e.g. 16mm film, warm stage lighting', true),
  { name: 'aspect', label: 'aspect ratio', kind: 'select' as const, options: ['inherit', '16:9', '9:16', '1:1', '4:3', '21:9'], default: 'inherit', advanced: true },
  { name: 'maxImages', label: 'reference images', kind: 'number' as const, default: 0, min: 0, max: 50, step: 1, advanced: true, description: 'Most images per clip; 0 = 9' },
  { name: 'maxClip', label: 'clip seconds', kind: 'number' as const, default: 0, min: 0, max: 60, step: 1, advanced: true, description: 'Longest clip; 0 = 15 s' },
];

const episodeNode = defineNode({
  type: D2.episode,
  title: 'Episode',
  category: 'Story',
  color: '#c2255c',
  icon: '▶',
  flavor: 'sink',
  width: 440,
  description: 'A titled, numbered episode: a set of scenes',
  params: [
    number(),
    { ...refs('scenes', 'scenes', D2.scene, true), create: true, movable: true, sortable: true, renumber: 'number' },
    text('description', 'description', 'Optional synopsis'),
    wardrobe('What each character wears in this episode, for all its scenes and shots (a scene or shot can still change it).'),
    images('images', 'poster', true),
    ...look,
  ],
  onCreate: (n) => void (n.label ??= 'Untitled episode'),
});

// ------------------------------------------------------------------ to and from the wired model

const TO_DRAMA: Record<string, string> = {
  [D2.character]: 'drama/character',
  [D2.prop]: 'drama/prop',
  [D2.location]: 'drama/location',
  [D2.shot]: 'drama/shot',
  [D2.scene]: 'drama/scene',
  [D2.episode]: 'drama/episode',
};

/**
 * The wired drama graph behind a board, with the same node ids. Props typed on shots become
 * prop nodes shared by name. Used by the engine, the details cards and the Seedance export.
 */
export function toDrama(board: Graph): Graph {
  const json: GraphJSON = { version: 1, type: 'drama', nodes: [], edges: [] };
  const has = (id: string, type: string) => board.nodes.get(id)?.type === type;
  const edge = (from: string, fromPort: string, to: string, toPort: string) =>
    json.edges.push({ id: `${from}>${to}:${toPort}`, from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
  for (const n of board.nodes.values()) {
    let type = TO_DRAMA[n.type];
    if (!type) continue;
    // An outfit is a prop to people, and a costume (worn by someone, scene by scene) to the drama model.
    if (isOutfit(n)) type = 'drama/costume';
    const { location, characters, props, shots, scenes, wornBy, kind, wearers, wardrobe, ...params } = n.params as Record<string, unknown>;
    void [location, characters, props, shots, scenes, wornBy, kind, wearers, wardrobe];
    // A board shot says exactly what everyone wears in it (see dressOf), scene costumes included.
    if (n.type === D2.shot) params.costumesExact = true;
    json.nodes.push({ id: n.id, type, x: n.x, y: n.y, params, ...(n.label ? { label: n.label } : {}) });
  }
  // Anyone can wear any outfit: on its usual wearer it is the outfit's own costume node; on
  // someone else, a copy of it worn by them (the drama model gives each costume one wearer).
  const costumeFor = (outfit: NodeInstance, who: NodeInstance) => {
    const id = who.id === idList(outfit.params.wornBy)[0] ? outfit.id : `${outfit.id}@${who.id}`;
    if (id !== outfit.id && !json.nodes.some((x) => x.id === id)) {
      const base = json.nodes.find((x) => x.id === outfit.id)!;
      json.nodes.push({ ...base, id, params: { ...base.params } });
      edge(who.id, 'appears', id, 'character');
    }
    return id;
  };
  const dress = (n: NodeInstance) => {
    for (const c of castOf(board, n)) {
      const o = dressOf(board, n, c.id).outfit;
      if (o) edge(costumeFor(o, c), 'scenes', n.id, 'costumes');
    }
  };
  for (const n of board.nodes.values()) {
    const ids = (k: string) => idList(n.params[k]);
    if (n.type === D2.shot) {
      ids('location').filter((id) => has(id, D2.location)).slice(0, 1).forEach((id) => edge(id, 'shots', n.id, 'location'));
      ids('characters').filter((id) => has(id, D2.character)).forEach((id) => edge(id, 'appears', n.id, 'characters'));
      // Objects are props; outfits (in props, as boards used to) dress someone (see dressOf).
      ids('props')
        .filter((x) => has(x, D2.prop) && !isOutfit(board.nodes.get(x)))
        .forEach((id) => edge(id, 'used', n.id, 'props'));
      dress(n);
    } else if (n.type === D2.scene) {
      ids('shots').filter((id) => has(id, D2.shot)).forEach((id) => edge(id, 'scene', n.id, 'shots'));
      // What the scene (or its episode) says, for scene-wide summaries and storyboards.
      dress(n);
    } else if (n.type === D2.episode) {
      ids('scenes').filter((id) => has(id, D2.scene)).forEach((id) => edge(id, 'episode', n.id, 'scenes'));
    } else if (isOutfit(n)) {
      ids('wornBy').filter((id) => has(id, D2.character)).slice(0, 1).forEach((id) => edge(id, 'appears', n.id, 'character'));
    }
  }
  // A shot in two scenes (or a scene in two episodes) keeps only its first parent.
  const seen = new Set<string>();
  json.edges = json.edges.filter((e) => {
    const parentPort = e.from.port === 'scene' || e.from.port === 'episode';
    if (!parentPort) return true;
    if (seen.has(e.from.node)) return false;
    seen.add(e.from.node);
    return true;
  });
  return Graph.fromJSON(json);
}

/**
 * A board from a wired drama map (the drama examples, or your own maps): wires become
 * references, prop nodes become prop names on shots, and seasons hand their video settings
 * down to their episodes.
 */
export function fromDrama(json: GraphJSON): GraphJSON {
  const nodes = new Map(json.nodes.map((n) => [n.id, n]));
  const into = (id: string, port: string) => json.edges.filter((e) => e.to.node === id && e.to.port === port).map((e) => e.from.node);
  const outOf = (id: string, port: string) => json.edges.filter((e) => e.from.node === id && e.from.port === port).map((e) => e.to.node);
  const out: GraphJSON = { version: 1, type: 'drama2', nodes: [], edges: [], meta: {} };
  const settings = ['style', 'aspect', 'maxImages', 'maxClip'];
  // Costumes wired into a scene (or a shot) become that scene's (or shot's) wardrobe.
  const wardrobeFrom = (id: string): Wardrobe =>
    Object.fromEntries(
      into(id, 'costumes')
        .map((c) => [into(c, 'character')[0], c] as const)
        .filter((x): x is readonly [string, string] => !!x[0]),
    );
  for (const n of json.nodes) {
    const base = { id: n.id, x: 0, y: 0, ...(n.label ? { label: n.label } : {}) };
    const p = n.params;
    switch (n.type) {
      case 'drama/character':
        out.nodes.push({ ...base, type: D2.character, params: { description: p.description ?? '', appearance: p.appearance ?? '', images: p.images ?? [], actor: p.actor ?? '' } });
        break;
      case 'drama/location':
        out.nodes.push({ ...base, type: D2.location, params: { setting: p.setting ?? 'INT', description: p.description ?? '', images: p.images ?? [] } });
        break;
      case 'drama/prop':
        out.nodes.push({ ...base, type: D2.prop, params: { kind: 'Object', wornBy: '', description: p.description ?? '', images: p.images ?? [] } });
        break;
      case 'drama/costume':
        out.nodes.push({ ...base, type: D2.prop, params: { kind: 'Outfit', wornBy: into(n.id, 'character')[0] ?? '', description: p.description ?? '', images: p.images ?? [] } });
        break;
      case 'drama/shot': {
        const { costumesExact, ...shotParams } = p;
        void costumesExact;
        out.nodes.push({
          ...base,
          type: D2.shot,
          params: {
            ...shotParams,
            location: into(n.id, 'location')[0] ?? '',
            characters: into(n.id, 'characters'),
            props: into(n.id, 'props'),
            wardrobe: wardrobeFrom(n.id),
          },
        });
        break;
      }
      case 'drama/scene':
        out.nodes.push({ ...base, type: D2.scene, params: { ...p, shots: into(n.id, 'shots'), wardrobe: wardrobeFrom(n.id) } });
        break;
      case 'drama/episode': {
        const season = nodes.get(outOf(n.id, 'season')[0] ?? '');
        const inherited = Object.fromEntries(settings.filter((k) => season?.params[k] && !(p[k] && p[k] !== 'inherit')).map((k) => [k, season!.params[k]]));
        out.nodes.push({ ...base, type: D2.episode, params: { ...p, ...inherited, scenes: into(n.id, 'scenes') } });
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ engine and view

export interface Drama2Link {
  id: string;
  title: string;
}
export interface Drama2List {
  title: string;
  items: Drama2Link[];
}

const sceneLabel = (board: Graph, wired: Graph, sceneId: string) => {
  const sc = board.nodes.get(sceneId);
  if (!sc) return sceneId;
  const ep = wired.outgoing(sceneId).map((e) => wired.nodes.get(e.to.node)).find((x) => x?.type === 'drama/episode');
  return `${ep ? `Ep ${Number(ep.params.number ?? 1)} · ` : ''}${nodeTitle(board, sc)}`;
};
const episodeLabel = (board: Graph, id: string) => {
  const ep = board.nodes.get(id);
  return ep ? `Episode ${Number(ep.params.number ?? 1)}: ${nodeTitle(board, ep)}` : id;
};
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** The lists a board node shows: where a character appears, who is in an episode, and so on. */
export function drama2Lists(board: Graph, wired: Graph, id: string): Drama2List[] {
  const n = board.nodes.get(id);
  if (!n) return [];
  const link = (x: string, title: string) => ({ id: x, title });
  const scenesOf = (apps: ReturnType<typeof appearances>) => uniq(apps.map((a) => a.scene?.id).filter((x): x is string => !!x));
  const episodesOf = (apps: ReturnType<typeof appearances>) => uniq(apps.map((a) => a.episode?.id).filter((x): x is string => !!x));
  const sceneSort = (ids: string[]) =>
    ids
      .map((x) => ({ x, ep: Number(wired.outgoing(x).map((e) => wired.nodes.get(e.to.node)).find((y) => y?.type === 'drama/episode')?.params.number ?? 1e9), sc: Number(board.nodes.get(x)?.params.number ?? 0) }))
      .sort((a, b) => a.ep - b.ep || a.sc - b.sc)
      .map((o) => o.x);
  const epSort = (ids: string[]) => [...ids].sort((a, b) => Number(board.nodes.get(a)?.params.number ?? 0) - Number(board.nodes.get(b)?.params.number ?? 0));
  if (n.type === D2.character || n.type === D2.location) {
    const apps = appearances(wired, id);
    const lists: Drama2List[] = [
      { title: 'Scenes', items: sceneSort(scenesOf(apps)).map((x) => link(x, sceneLabel(board, wired, x))) },
      { title: 'Episodes', items: epSort(episodesOf(apps)).map((x) => link(x, episodeLabel(board, x))) },
    ];
    if (n.type === D2.character) lists.push({ title: 'Outfits', items: outfitsOf(board, id).map((o) => link(o.id, nodeTitle(board, o))) });
    return lists;
  }
  if (n.type === D2.prop) {
    // Where it is used: the shots that list it (an outfit: where someone wears it), their scenes and episodes.
    const shots = isOutfit(n)
      ? [...board.nodes.values()].filter((sh) => sh.type === D2.shot && castOf(board, sh).some((c) => dressOf(board, sh, c.id).outfit?.id === id))
      : referrers(board, id, D2.shot, 'props');
    const scenes = uniq(shots.flatMap((s) => referrers(board, s.id, D2.scene, 'shots').map((sc) => sc.id)));
    const eps = uniq(scenes.flatMap((sc) => referrers(board, sc, D2.episode, 'scenes').map((e) => e.id)));
    return [
      { title: 'Scenes', items: sceneSort(scenes).map((x) => link(x, sceneLabel(board, wired, x))) },
      { title: 'Episodes', items: epSort(eps).map((x) => link(x, episodeLabel(board, x))) },
    ];
  }
  if (n.type === D2.shot) {
    const scenes = referrers(board, id, D2.scene, 'shots');
    const eps = uniq(scenes.flatMap((sc) => referrers(board, sc.id, D2.episode, 'scenes').map((e) => e.id)));
    return [
      { title: 'Scene', items: scenes.map((sc) => link(sc.id, sceneLabel(board, wired, sc.id))) },
      { title: 'Episodes', items: epSort(eps).map((x) => link(x, episodeLabel(board, x))) },
    ];
  }
  if (n.type === D2.scene) {
    const w = wired.nodes.get(id);
    const info = w ? sceneInfo(wired, w) : undefined;
    return [
      { title: 'Episode', items: referrers(board, id, D2.episode, 'scenes').map((e) => link(e.id, episodeLabel(board, e.id))) },
      { title: 'Characters', items: (info?.characters ?? []).map((c) => link(c.id, nodeTitle(board, board.nodes.get(c.id) ?? c))) },
      { title: 'Locations', items: (info?.locations ?? []).map((l) => link(l.id, nodeTitle(board, board.nodes.get(l.id) ?? l))) },
      {
        title: 'Props',
        // Objects in its shots, and each outfit with whoever wears it in them (one entry per wearer).
        items: uniq(
          refsOf(board, n, 'shots').flatMap((s) => [
            ...refsOf(board, s, 'props')
              .filter((o) => !isOutfit(o))
              .map((o) => `${o.id}\u0000`),
            ...castOf(board, s).flatMap((c) => {
              const o = dressOf(board, s, c.id).outfit;
              return o ? [`${o.id}\u0000${nodeTitle(board, c)}`] : [];
            }),
          ]),
        ).map((k) => {
          const [oid, who] = k.split('\u0000');
          return link(oid, `${nodeTitle(board, board.nodes.get(oid)!)}${who ? ` (${who})` : ''}`);
        }),
      },
    ];
  }
  if (n.type === D2.episode) {
    const w = wired.nodes.get(id);
    const info = w ? episodeInfo(wired, w) : undefined;
    return [
      { title: 'Actors', items: (info?.characters ?? []).map((c) => link(c.id, `${nodeTitle(board, board.nodes.get(c.id) ?? c)}${c.params.actor ? ` (${c.params.actor})` : ''}`)) },
      { title: 'Locations', items: (info?.locations ?? []).map((l) => link(l.id, nodeTitle(board, board.nodes.get(l.id) ?? l))) },
    ];
  }
  return [];
}

/**
 * Runs the drama engine on the wired version of the board, and adds each node's lists
 * (`outputs.lists`) for the view.
 */
export const drama2Engine: GraphEngine = {
  name: 'Drama breakdown',
  callable: false,
  async run(ctx) {
    const wired = toDrama(ctx.graph);
    return dramaEngine.run({
      ...ctx,
      graph: wired,
      publish: (id, r) => {
        if (!ctx.graph.nodes.has(id)) return;
        ctx.publish(id, { ...r, outputs: { ...r.outputs, lists: drama2Lists(ctx.graph, wired, id) } });
      },
    });
  },
};

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The drama status line, then expandable lists whose titles jump to their node. */
export const drama2View = {
  render(el: HTMLElement, r: NodeResult | undefined, node: NodeInstance) {
    // Keep lists open across re-renders (the engine re-runs on every edit).
    const open = new Set([...el.querySelectorAll<HTMLDetailsElement>('details[data-list]')].filter((d) => d.open).map((d) => d.dataset.list!));
    const status = document.createElement('div');
    dramaView.render(status, r, node);
    const lists = (r?.outputs?.lists as Drama2List[] | undefined) ?? [];
    el.replaceChildren(status);
    for (const l of lists) {
      const d = document.createElement('details');
      d.className = 'dr2-list';
      d.dataset.list = l.title;
      d.dataset.nmLive = '';
      d.open = open.has(l.title);
      d.innerHTML =
        `<summary>${esc(l.title)} <span>${l.items.length}</span></summary>` +
        (l.items.length ? `<ul>${l.items.map((i) => `<li><button type="button" data-nm-open="${esc(i.id)}">${esc(i.title)}</button></li>`).join('')}</ul>` : `<p>None yet</p>`);
      el.append(d);
    }
  },
};

const css = `
.dr2-refs { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.dr2-chip { display: inline-flex; align-items: stretch; border: 1px solid var(--_border); border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--_accent) 8%, var(--_node)); }
.dr2-chip button { all: unset; cursor: pointer; font: 500 12px/1 var(--_font); color: var(--_text); padding: 6px 10px; }
.dr2-wardrobe { display: flex; flex-direction: column; gap: 6px; min-width: 0; width: 100%; }
.dr2-wardrobe-row { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dr2-wardrobe-row > span { font: 500 11px/1.2 var(--_font); color: var(--_muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr2-wardrobe-row select { width: 100%; min-width: 0; font: 12px var(--_font); color: var(--_text); background: var(--_node-2, var(--_node)); border: 1px solid var(--_border); border-radius: 6px; height: 28px; padding: 0 4px; }
.dr2-wardrobe-empty { color: var(--_muted); font: 12px var(--_font); }
.dr2-chip .dr2-wearer { appearance: none; border: 0; border-left: 1px solid var(--_border); background: color-mix(in srgb, var(--_accent) 14%, var(--_node)); color: var(--_text);
  font: 500 11px/1 var(--_font); padding: 0 20px 0 8px; cursor: pointer; max-width: 130px; text-overflow: ellipsis;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 7px center; background-size: 9px 6px; }
.dr2-chip .dr2-wearer:disabled { cursor: default; opacity: .7; }
.dr2-chip .dr2-wearer:focus-visible { outline: 2px solid var(--_accent); outline-offset: -2px; }
.dr2-chip button[data-nm-open]:hover, .dr2-chip button[data-nm-open]:focus-visible { color: var(--_accent); text-decoration: underline; }
.dr2-chip .dr2-x { padding: 6px 8px 6px 2px; color: var(--_muted); }
.nm-node:not(.nm-selected) .dr2-chip .dr2-x { display: none; }
.nm-root[data-readonly] :is(.dr2-x, .dr2-mv, .dr2-pick) { display: none !important; }
.dr2-chip .dr2-mv { padding: 6px 9px; min-width: 14px; text-align: center; color: var(--_muted); font-weight: 700; font-size: 14px; }
.dr2-chip .dr2-mv:disabled { opacity: .3; cursor: default; }
.nm-node:not(.nm-selected) .dr2-chip .dr2-mv { display: none; }
.dr2-pick { font: 12px var(--_font); max-width: 100%; min-height: 28px; }
.nm-node:not(.nm-selected) .dr2-pick { display: none; }
.dr2-search { font: 500 12px/1 var(--_font); min-height: 30px; padding: 0 12px; border-radius: 999px; border: 1px dashed var(--_border);
  background: transparent; color: var(--_accent); cursor: pointer; }
.dr2-search:hover, .dr2-search:focus-visible { border-color: var(--_accent); }
.nm-node:has(.dr2-list) .nm-view { max-height: none; overflow: visible; }
.dr2-list { margin-top: 6px; border-top: 1px solid var(--_border); padding-top: 4px; font: 12px/1.35 var(--_font); }
.dr2-list summary { cursor: pointer; font-weight: 600; padding: 4px 0; list-style-position: inside; }
.dr2-list summary span { color: var(--_muted); font-weight: 500; margin-left: 2px; }
.dr2-list ul { list-style: none; margin: 2px 0 4px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.dr2-list li button { all: unset; cursor: pointer; display: block; width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; color: var(--_accent); }
.dr2-list li button:hover, .dr2-list li button:focus-visible { background: color-mix(in srgb, var(--_accent) 12%, transparent); }
.dr2-list p { margin: 2px 0 4px; color: var(--_muted); font-style: italic; }
`;

/** Details cards come from the drama types, on the wired version of the board. */
const details = (node: NodeInstance, ctx: { graph: Graph }) => {
  const wired = toDrama(ctx.graph);
  const w = wired.nodes.get(node.id);
  const fn = DRAMA_DETAILS;
  return w ? fn(w, { graph: wired }) : { title: nodeTitle(ctx.graph, node) };
};

const nodes: NodeType[] = [characterNode, propNode, locationNode, shotNode, sceneNode, episodeNode].map((n) => ({ ...n, view: drama2View, details }));

export const drama2Pack = definePack({
  id: 'nodemap/drama2',
  title: 'Drama boards',
  paramKinds: [imagesParam, clipFrameParam, refParam, refsParam, wardrobeParam],
  nodes,
  css: (dramaPack.css ?? '') + css,
});
