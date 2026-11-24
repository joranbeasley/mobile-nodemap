import { defineGraphType } from '../core/graph-type.js';
import type { GraphJSON, NodeInstance } from '../core/types.js';
import { dramaEngine, dramaPack, shotInfo } from '../packs/drama.js';

// ------------------------------------------------------------------ example pictures (tiny SVG sketches)

const svg = (body: string) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">${body}</svg>`);

const art = {
  hall: svg(
    '<rect width="160" height="100" fill="#3b2a4a"/><rect x="0" y="70" width="160" height="30" fill="#8a5a2b"/><rect x="0" y="0" width="34" height="80" fill="#b02a37"/><rect x="126" y="0" width="34" height="80" fill="#b02a37"/><rect x="0" y="0" width="160" height="12" fill="#c92a2a"/><path d="M60 0 L40 70 L120 70 L100 0Z" fill="#ffe066" opacity=".25"/>',
  ),
  hallSeats: svg(
    '<rect width="160" height="100" fill="#2b2238"/><rect x="20" y="8" width="120" height="40" fill="#8a5a2b"/><g fill="#5c3d6e">' +
      Array.from({ length: 12 }, (_, i) => `<rect x="${8 + i * 12.5}" y="62" width="10" height="12" rx="2"/><rect x="${8 + i * 12.5}" y="80" width="10" height="12" rx="2"/>`).join('') +
      '</g>',
  ),
  backstage: svg(
    '<rect width="160" height="100" fill="#1f2229"/><g stroke="#868e96" stroke-width="2"><line x1="30" y1="0" x2="30" y2="100"/><line x1="44" y1="0" x2="44" y2="100"/><line x1="30" y1="20" x2="44" y2="20"/><line x1="30" y1="40" x2="44" y2="40"/><line x1="30" y1="60" x2="44" y2="60"/><line x1="30" y1="80" x2="44" y2="80"/></g><rect x="80" y="40" width="50" height="40" fill="#495057"/><circle cx="120" cy="18" r="8" fill="#ffd43b"/><path d="M120 18 L90 100 L150 100Z" fill="#ffd43b" opacity=".18"/>',
  ),
  carpark: svg(
    '<defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#f08c00"/><stop offset="1" stop-color="#5f3dc4"/></linearGradient></defs><rect width="160" height="100" fill="url(#s)"/><rect y="64" width="160" height="36" fill="#343a40"/><g stroke="#f8f9fa" stroke-width="2"><line x1="20" y1="72" x2="14" y2="98"/><line x1="60" y1="72" x2="56" y2="98"/><line x1="100" y1="72" x2="102" y2="98"/><line x1="140" y1="72" x2="146" y2="98"/></g><line x1="128" y1="20" x2="128" y2="66" stroke="#212529" stroke-width="3"/><circle cx="122" cy="20" r="5" fill="#fff3bf"/>',
  ),
  person: (bg: string, skin: string, hair: string, shirt: string) =>
    svg(`<rect width="160" height="100" fill="${bg}"/><path d="M40 100 Q80 50 120 100Z" fill="${shirt}"/><circle cx="80" cy="44" r="20" fill="${skin}"/><path d="M58 42 Q60 18 80 18 Q100 18 102 42 Q96 28 80 28 Q64 28 58 42Z" fill="${hair}"/>`),
  script: svg('<rect width="160" height="100" fill="#e9ecef"/><rect x="50" y="10" width="60" height="80" fill="#fff" stroke="#adb5bd" transform="rotate(-6 80 50)"/><g stroke="#868e96" stroke-width="2" transform="rotate(-6 80 50)"><line x1="58" y1="24" x2="100" y2="24"/><line x1="58" y1="34" x2="94" y2="34"/><line x1="66" y1="46" x2="100" y2="46"/><line x1="58" y1="58" x2="98" y2="58"/><line x1="58" y1="70" x2="86" y2="70"/></g>'),
  /** Storyboard frames: pencil figures, small for wide shots and big for close-ups. */
  frame: (kind: 'wide' | 'medium' | 'close' | 'two' | 'ots' | 'pov' | 'insert', note = '') => {
    const fig = (x: number, y: number, s: number) =>
      `<g stroke="#495057" stroke-width="${Math.max(1.2, 2.2 * s)}" fill="none" stroke-linecap="round"><circle cx="${x}" cy="${y}" r="${7 * s}"/><path d="M${x} ${y + 7 * s} V${y + 30 * s} M${x - 12 * s} ${y + 16 * s} L${x} ${y + 12 * s} L${x + 12 * s} ${y + 16 * s} M${x} ${y + 30 * s} L${x - 9 * s} ${y + 46 * s} M${x} ${y + 30 * s} L${x + 9 * s} ${y + 46 * s}"/></g>`;
    const body =
      kind === 'wide'
        ? `<line x1="0" y1="76" x2="160" y2="76" stroke="#adb5bd"/>${fig(50, 50, 0.5)}${fig(80, 52, 0.45)}${fig(110, 50, 0.5)}`
        : kind === 'medium'
          ? fig(80, 26, 1.3)
          : kind === 'close'
            ? `<circle cx="80" cy="52" r="30" stroke="#495057" stroke-width="2.4" fill="none"/><path d="M68 48h4M88 48h4M72 66q8 6 16 0" stroke="#495057" stroke-width="2" fill="none"/>`
            : kind === 'two'
              ? fig(56, 24, 1.15) + fig(104, 24, 1.15)
              : kind === 'ots'
                ? `<path d="M0 100 Q10 40 50 40 Q70 40 74 100Z" fill="#ced4da"/>${fig(110, 22, 1.2)}`
                : kind === 'pov'
                  ? `<path d="M0 0h160v100H0Z M20 18h120v64H20Z" fill="#212529" fill-rule="evenodd" opacity=".75"/>${fig(80, 28, 0.9)}`
                  : `<rect x="54" y="26" width="52" height="48" fill="#fff" stroke="#495057" stroke-width="2" transform="rotate(-8 80 50)"/>`;
    return svg(`<rect width="160" height="100" fill="#f8f9fa"/><rect x="3" y="3" width="154" height="94" fill="none" stroke="#ced4da" stroke-width="2"/>${body}${note ? `<text x="8" y="92" font-family="sans-serif" font-size="9" fill="#868e96">${note}</text>` : ''}`);
  },
};

// ------------------------------------------------------------------ builders

type P = Record<string, unknown>;
const node = (id: string, type: string, params: P, label?: string): NodeInstance => ({ id, type: `drama/${type}`, x: 0, y: 0, params, ...(label ? { label } : {}) });
const loc = (id: string, name: string, setting: 'INT' | 'EXT', description: string, images: string[]) => node(id, 'location', { setting, description, images }, name);
const who = (id: string, name: string, description: string, images: string[], actor = '') => node(id, 'character', { description, images, actor }, name);
const prop = (id: string, name: string, description: string, images: string[] = []) => node(id, 'prop', { description, images }, name);
const shot = (id: string, number: string, framing: string, description: string, images: string[], extra: P = {}) =>
  node(id, 'shot', { number, framing, description, images, movement: 'Static', duration: 6, ...extra });
const scene = (id: string, number: number, time: string, description: string) => node(id, 'scene', { number, time, description, storyboard: [] });
const episode = (id: string, number: number, title: string, description = '') => node(id, 'episode', { number, description, images: [] }, title);

const OUT: Record<string, string> = { location: 'shots', character: 'appears', prop: 'used', shot: 'scene', scene: 'episode', episode: 'season' };
const IN: Record<string, string> = { location: 'location', character: 'characters', prop: 'props', shot: 'shots', scene: 'scenes', episode: 'episodes' };

/** Build a production from [piece, whole] pairs: ports are picked from the node types. */
function production(nodes: NodeInstance[], links: [string, string | string[]][]): GraphJSON {
  const kind = new Map(nodes.map((n) => [n.id, n.type.replace('drama/', '')]));
  const edges = links.flatMap(([a, bs]) =>
    ([] as string[]).concat(bs).map((b) => ({ id: `${a}-${b}`, from: { node: a, port: OUT[kind.get(a)!] }, to: { node: b, port: IN[kind.get(a)!] } })),
  );
  return { version: 1, type: 'drama', nodes, edges };
}

// ------------------------------------------------------------------ graph type

/**
 * Drama productions for a drama club, a student film or a web series: characters, locations
 * and props feed shots; numbered shots make scenes, scenes make episodes, episodes make a
 * season. A shot has one location and any number of characters; a shot belongs to one
 * scene, a scene to one episode and an episode to one season.
 */
export const dramaGraph = defineGraphType({
  id: 'drama',
  title: 'Drama',
  description: 'Plan a production: characters, locations and props feed shots, shots make numbered scenes, scenes make episodes. Each node shows where it is used; tap a scene or episode for its shot list.',
  icon: '🎭',
  packs: [dramaPack],
  engine: dramaEngine,
  rules: {
    canConnect: (from, to, graph) => {
      const parent: Record<string, string> = { 'drama/shot': 'scene', 'drama/scene': 'episode', 'drama/episode': 'season' };
      const type = graph.nodes.get(from.node)?.type ?? '';
      const taken = parent[type] && graph.outgoing(from.node).some((e) => e.to.node !== to.node);
      if (taken) return `A ${type.replace('drama/', '')} belongs to one ${parent[type]}: remove its wire first`;
    },
    validate: (graph) =>
      [...graph.nodes.values()]
        .filter((n) => n.type === 'drama/shot' && !shotInfo(graph, n).location)
        .map((n) => ({ level: 'warning' as const, message: `Shot ${String(n.params.number ?? '?')} has no location`, node: n.id })),
  },
  editor: { wires: 'smart', autoLayout: true },
  examples: [
    {
      id: 'term',
      name: 'Spring term',
      description: 'Tap a scene or episode for its Seedance video script and asset pack, or a character to see every shot they are in. Select a node, then tap a picture to view it or “+” to add your own.',
      graph: production(
        [
          who('maya', 'Maya', 'Stage manager. Runs everything from the wings with a clipboard and a headset.', [art.person('#d0ebff', '#c68642', '#2b2b2b', '#1971c2')], 'Priya S.'),
          who('theo', 'Theo', 'The lead. Brilliant in rehearsal, terrified of an audience.', [art.person('#ffe8cc', '#f1c27d', '#a0522d', '#e8590c')], 'Sam R.'),
          who('jules', 'Jules', 'The understudy who knows every line of every part.', [art.person('#e5dbff', '#e0ac69', '#f59f00', '#7048e8')], 'Alex K.'),
          who('okafor', 'Ms Okafor', 'Drama teacher. Calm, until the lights fail.', [art.person('#d3f9d8', '#8d5524', '#495057', '#2f9e44')], 'Mrs Bell'),
          loc('hall', 'School hall', 'INT', 'The main hall: a raised stage, red curtains and 200 folding chairs.', [art.hall, art.hallSeats]),
          loc('back', 'Backstage', 'INT', 'Narrow, dark, full of rope and old scenery flats.', [art.backstage]),
          loc('park', 'Car park', 'EXT', 'Behind the school at sunset. One flickering lamp.', [art.carpark]),
          prop('script', 'Dog-eared script', 'Theo’s copy, every line highlighted twice.', [art.script]),

          shot('s1a', '1', 'Wide', 'The club gathers on the empty stage for the read-through.', [art.frame('wide', 'establishing')], { duration: 8, movement: 'Dolly' }),
          shot('s1b', '2', 'Close-up', 'Theo freezes on his first line.', [art.frame('close')], { duration: 4 }),
          shot('s1c', '3', 'Two-shot', 'Maya and Jules exchange a look.', [art.frame('two')], { duration: 5 }),
          shot('s2a', '1', 'Medium', 'Jules mouths every line along with the rehearsal.', [art.frame('medium')], { duration: 6 }),
          shot('s2b', '2', 'Over the shoulder', 'Maya catches Jules: “You know all of it?”', [art.frame('ots')], { duration: 7 }),
          shot('s3a', '1', 'Wide', 'Theo walks off across the car park.', [art.frame('wide')], { duration: 9, movement: 'Handheld' }),
          shot('s3b', '2', 'Close-up', 'Ms Okafor watches him go.', [art.frame('close')], { duration: 4 }),
          shot('s4a', '1', 'Point of view', 'From the wings: a full house.', [art.frame('pov', 'POV from wings')], { duration: 5 }),
          shot('s4b', '2', 'Insert', 'The script, left on a chair.', [art.frame('insert')], { duration: 3 }),
          shot('s4c', '3', 'Full', 'Jules steps into the light.', [art.frame('medium')], { duration: 8, movement: 'Crane' }),

          scene('sc1', 1, 'DAY', 'Read-through. Theo can’t get past his first line.'),
          scene('sc2', 2, 'NIGHT', 'Maya discovers Jules has learned the whole play.'),
          scene('sc3', 3, 'EVENING', 'Theo quits. Ms Okafor lets him go.'),
          scene('sc4', 1, 'NIGHT', 'Opening night. Jules goes on.'),

          episode('ep1', 1, 'The Read-Through', 'Rehearsals start badly and Theo walks out.'),
          episode('ep2', 2, 'Opening Night'),
          node('season', 'season', { number: 1, description: 'One term, one play, one understudy.', style: 'Warm, grounded British school drama. 35mm film look, practical stage lighting, gentle handheld energy', aspect: '16:9' }, 'Spring term'),
        ],
        [
          ['hall', ['s1a', 's1b', 's1c', 's4a', 's4c']],
          ['back', ['s2a', 's2b', 's4b']],
          ['park', ['s3a', 's3b']],
          ['maya', ['s1a', 's1c', 's2b', 's4a']],
          ['theo', ['s1a', 's1b', 's3a']],
          ['jules', ['s1a', 's1c', 's2a', 's2b', 's4c']],
          ['okafor', ['s1a', 's3b']],
          ['script', ['s1b', 's4b']],
          ['s1a', 'sc1'],
          ['s1b', 'sc1'],
          ['s1c', 'sc1'],
          ['s2a', 'sc2'],
          ['s2b', 'sc2'],
          ['s3a', 'sc3'],
          ['s3b', 'sc3'],
          ['s4a', 'sc4'],
          ['s4b', 'sc4'],
          ['s4c', 'sc4'],
          ['sc1', 'ep1'],
          ['sc2', 'ep1'],
          ['sc3', 'ep1'],
          ['sc4', 'ep2'],
          ['ep1', 'season'],
          ['ep2', 'season'],
        ],
      ),
    },
    {
      id: 'scene',
      name: 'One scene',
      description: 'A single scene to start from. Add a shot with “+”, wire a location and characters into it, then wire it into the scene.',
      graph: production(
        [
          loc('kitchen', 'Kitchen', 'INT', 'A small kitchen, morning light.', []),
          who('a', 'Ana', 'Packing for a trip she hasn’t told anyone about.', [art.person('#fff3bf', '#e0ac69', '#343a40', '#f08c00')]),
          who('b', 'Ben', 'Her brother. Notices everything.', [art.person('#dbe4ff', '#c68642', '#5c3d2e', '#364fc7')]),
          shot('k1', '1', 'Wide', 'Ana fills a bag. Ben appears in the doorway.', [art.frame('wide')]),
          shot('k2', '2', 'Close-up', 'Ben: “Going somewhere?”', [art.frame('close')], { duration: 3 }),
          scene('ks', 1, 'MORNING', 'Ben finds out.'),
        ],
        [
          ['kitchen', ['k1', 'k2']],
          ['a', 'k1'],
          ['b', ['k1', 'k2']],
          ['k1', 'ks'],
          ['k2', 'ks'],
        ],
      ),
    },
  ],
});
