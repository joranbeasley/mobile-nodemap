import {
  Graph,
  Registry,
  Evaluator,
  NodeEditor,
  compile,
  graphNode,
  signature,
  defineNode,
  formatValue,
  layered,
  elkLayout,
  mathGraph,
  networkGraph,
  umlGraph,
  dramaGraph,
  drama2Graph,
  setDramaFileSaver,
  setImageGenerator,
  meshyImageGenerator,
  functionGraph,
  NodeLibrary,
  localStorageStore,
  listThemes,
  getTheme,
  emitSource,
  camel,
  type LibraryEntry,
  registerGraphType,
  type GraphJSON,
  type GraphType,
  type GraphExample,
  type LayoutEngine,
} from '../src/index.js';
import { defineDemoNodes, mountElement, mountReact, unmountReact } from './integrations.js';
import { paletteGraph } from './palette.js';

// ------------------------------------------------------------------ graph types

// The playground's math: the built-in math graph type plus a few custom nodes.
const hypotGraph: GraphJSON = {
  version: 1,
  nodes: [
    { id: 'a', type: 'graph/input', x: 0, y: 0, params: { name: 'a', type: 'number', value: 3 } },
    { id: 'b', type: 'graph/input', x: 0, y: 160, params: { name: 'b', type: 'number', value: 4 } },
    { id: 'e', type: 'math/expression', x: 240, y: 40, params: { vars: 'a, b', expr: 'sqrt(a*a + b*b)' } },
    { id: 'o', type: 'graph/output', x: 500, y: 60, params: { name: 'c' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'a', port: 'value' }, to: { node: 'e', port: 'a' } },
    { id: 'e2', from: { node: 'b', port: 'value' }, to: { node: 'e', port: 'b' } },
    { id: 'e3', from: { node: 'e', port: 'out' }, to: { node: 'o', port: 'value' } },
  ],
};

const N = (id: string, type: string, x: number, y: number, params: Record<string, unknown> = {}) => ({ id, type, x, y, params });
const E = (from: string, fp: string, to: string, tp: string) => ({ id: `${from}.${fp}-${to}.${tp}`, from: { node: from, port: fp }, to: { node: to, port: tp } });

// The library of custom nodes people build in the Function builder. Plain JSON, kept through a StoragePort.
const libraryStore = localStorageStore<LibraryEntry[]>('nodemap-demo:');
const library = new NodeLibrary();
library.on('change', (entries) => void libraryStore.put('library', entries));

const demoMath = registerGraphType(
  mathGraph.extend({
    id: 'demo/math',
    title: 'Math',
    icon: 'ƒ',
    nodes: [
      // A node written in TypeScript with shorthand, typed ports.
      defineNode({
        type: 'units/f-to-c',
        title: '°F → °C',
        category: 'Custom',
        color: '#be4bdb',
        description: 'A custom node written in TypeScript',
        inputs: { f: { type: 'number', default: 72 } },
        outputs: { c: 'number' },
        run: ({ f }) => ({ c: ((f - 32) * 5) / 9 }),
      }),
    ],
    setup(registry) {
      // A node made *from a node map*: compile() turns the map into a function, graphNode() wraps it.
      registry.define({ ...graphNode({ type: 'fn/hypot', title: 'Hypotenuse', category: 'Custom', color: '#be4bdb', graph: hypotGraph, registry }), description: 'A node built from another node map' });
      defineDemoNodes(registry);
      registry.use(library.toPack());
    },
    examples: [
      ...mathGraph.examples!,
      {
        id: 'custom',
        name: 'Custom nodes',
        description: '“°F → °C” is written in TypeScript. “Hypotenuse” is itself a node map.',
        graph: {
          version: 1,
          nodes: [
            N('f', 'value/number', 0, 0, { value: 98.6 }),
            N('conv', 'units/f-to-c', 260, 0),
            N('hyp', 'fn/hypot', 260, 190, { a: 22.5, b: 30 }),
            N('cmp', 'logic/compare', 520, 60, { op: '>' }),
            N('if', 'logic/if', 760, 60, { then: 'fever', else: 'normal' }),
            N('out', 'view/display', 1000, 90),
          ],
          edges: [E('f', 'value', 'conv', 'f'), E('conv', 'c', 'cmp', 'a'), E('hyp', 'c', 'cmp', 'b'), E('cmp', 'out', 'if', 'cond'), E('if', 'out', 'out', 'value')],
        },
      },
      {
        id: 'tidy',
        name: 'Tidy me',
        description: 'These nodes are piled up. Press the tidy button (or L). The map flows left to right, or top to bottom on a portrait phone.',
        graph: {
          version: 1,
          nodes: [
            N('a', 'value/number', 120, 60, { value: 3 }),
            N('b', 'value/number', 40, 10, { value: 4 }),
            N('add', 'math/add', 90, 120),
            N('mul', 'math/multiply', 10, 90),
            N('hyp', 'fn/hypot', 150, 20),
            N('ex', 'math/expression', 60, 150, { vars: 'p, q, h', expr: '(p + q) / h' }),
            N('cmp', 'logic/compare', 170, 110, { op: '>' }),
            N('if', 'logic/if', 30, 40, { then: 'above', else: 'below' }),
            N('show', 'view/display', 110, 170),
            N('rng', 'list/range', 0, 130, { count: 40 }),
            N('map', 'list/map', 140, 140, { expr: 'x * x' }),
            N('plot', 'view/plot', 80, 30),
          ],
          edges: [
            E('a', 'value', 'add', 'a'), E('b', 'value', 'add', 'b'), E('a', 'value', 'mul', 'a'), E('b', 'value', 'mul', 'b'),
            E('a', 'value', 'hyp', 'a'), E('b', 'value', 'hyp', 'b'), E('add', 'out', 'ex', 'p'), E('mul', 'out', 'ex', 'q'),
            E('hyp', 'c', 'ex', 'h'), E('ex', 'out', 'cmp', 'a'), E('cmp', 'out', 'if', 'cond'), E('if', 'out', 'show', 'value'),
            E('rng', 'list', 'map', 'list'), E('map', 'list', 'plot', 'value'),
          ],
        },
      },
    ],
  }),
);
registerGraphType(paletteGraph);

// The function builder can use the playground's custom nodes and everything already in the library.
const demoFunction = registerGraphType(
  functionGraph.extend({
    id: 'demo/function',
    title: 'Function builder',
    icon: 'λ',
    examples: functionGraph.examples,
    setup(registry) {
      registry.use(library.toPack());
    },
  }),
);

const safeStorage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: the key lasts until reload */
    }
  },
};
// ✨ Generate in image fields: Meshy text-to-image with the visitor's own API key, kept in this
// browser only and sent only to Meshy.
setImageGenerator(
  meshyImageGenerator({
    key: {
      label: 'Meshy API key',
      get: () => safeStorage.get('nodemap-demo:meshy-key'),
      set: (v) => safeStorage.set('nodemap-demo:meshy-key', v),
    },
  }),
);

// Published as a claude.ai artifact, files are handed over through the `downloads` capability.
type Downloads = { save(f: { filename: string; data: Blob | string }): Promise<unknown> };
(window as unknown as { claude?: { use(name: string): Promise<Downloads | null> } }).claude
  ?.use('downloads')
  .then((d) => d && setDramaFileSaver((f) => d.save(f)))
  .catch(() => undefined);

const graphTypes: GraphType[] = [demoMath, demoFunction, networkGraph, umlGraph, dramaGraph, drama2Graph, paletteGraph];
type Example = GraphExample;

// ------------------------------------------------------------------ app

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const store = {
  key: (type: string, id: string) => `nodemap-demo:${type}:${id}`,
  get(type: string, id: string): GraphJSON | null {
    return safe(() => JSON.parse(localStorage.getItem(this.key(type, id)) ?? 'null'), null);
  },
  set(type: string, id: string, json: GraphJSON) {
    safe(() => localStorage.setItem(this.key(type, id), JSON.stringify(json)), undefined);
  },
  clear(type: string, id: string) {
    safe(() => localStorage.removeItem(this.key(type, id)), undefined);
  },
};

// One editor session per graph type: switching types builds a fresh registry, graph and editor.
let gtype: GraphType = demoMath;
let registry: Registry;
let graph: Graph;
let evaluator: Evaluator;
let editor: NodeEditor;
let examples: Example[] = [];
let current: Example;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let layoutEngine: LayoutEngine = layered();

const statusEl = $('#status');
const blurbEl = $('#blurb');
// The tip under the tabs can be hidden (and brought back with "i"); the choice is remembered.
const tipEl = $('#tip');
const tipShow = $<HTMLButtonElement>('#tip-show');
const setTip = (hidden: boolean) => {
  tipEl.hidden = hidden;
  tipShow.hidden = !hidden;
  safe(() => (hidden ? localStorage.setItem('nodemap-demo:tip-hidden', '1') : localStorage.removeItem('nodemap-demo:tip-hidden')), undefined);
};
setTip(safe(() => localStorage.getItem('nodemap-demo:tip-hidden') === '1', false));
$('#tip-hide').addEventListener('click', () => setTip(true));
tipShow.addEventListener('click', () => setTip(false));
const wiresSel = $<HTMLSelectElement>('#wires');
const engineSel = $<HTMLSelectElement>('#engine');
const typeSel = $<HTMLSelectElement>('#gtype');

for (const t of graphTypes) typeSel.append(new Option(`${t.icon ?? ''} ${t.title}`.trim(), t.id));

// Themes: "Page colours" follows this page's palette; the rest are the library's built-in themes.
const themeSel = $<HTMLSelectElement>('#theme');
themeSel.append(new Option('Page colours', ''));
for (const mode of ['light', 'dark'] as const) {
  const group = document.createElement('optgroup');
  group.label = mode === 'light' ? 'Light themes' : 'Dark themes';
  for (const t of listThemes().filter((x) => x.mode === mode)) group.append(new Option(t.name, t.id));
  themeSel.append(group);
}
themeSel.value = safe(() => localStorage.getItem('nodemap-demo:theme'), null) ?? '';
function applyTheme() {
  const t = themeSel.value ? getTheme(themeSel.value) : undefined;
  editor?.setTheme(t ?? null);
  // Keep the page chrome in the same light/dark mode as the canvas.
  if (t) document.documentElement.dataset.theme = t.mode;
  else delete document.documentElement.dataset.theme;
}
themeSel.addEventListener('change', () => {
  safe(() => localStorage.setItem('nodemap-demo:theme', themeSel.value), undefined);
  applyTheme();
});

function startSession(type: GraphType) {
  editor?.destroy();
  gtype = type;
  registry = type.createRegistry();
  graph = new Graph(registry);
  evaluator = new Evaluator(graph, registry);
  editor = new NodeEditor($('#canvas'), { graph, registry, evaluator, wires: wiresSel.value as 'smart' | 'curved', layout: layoutEngine, direction: type.editor?.direction, views: type.editor?.views, plugins: type.editor?.plugins, edgeStyle: type.editor?.edgeStyle });
  applyTheme();
  const building = type === demoFunction;
  ($('[data-panel="build"]') as HTMLElement).hidden = !building;
  if (!building && openPanel === 'build') showPanel(null);
  examples = type.examples ?? [];
  typeSel.value = type.id;
  document.body.dataset.gtype = type.id;
  // The "Call" panel only makes sense for maps that run as functions.
  const callable = !registry.engine || registry.engine.callable;
  ($('[data-panel="call"]') as HTMLElement).hidden = !callable;
  if (!callable && openPanel === 'call') showPanel(null);

  evaluator.on('start', () => statusEl.setAttribute('data-state', 'running'));
  evaluator.on('done', (r) => {
    statusEl.setAttribute('data-state', r.errors.length ? 'error' : 'ok');
    if (registry.engine && 'online' in r.outputs) {
      const o = r.outputs as { online: number; offline: number; worstLatency: number };
      statusEl.textContent = `${o.online} online · ${o.offline} offline · worst ${o.worstLatency} ms`;
    } else if (registry.engine && typeof r.outputs.summary === 'string') {
      statusEl.setAttribute('data-state', r.errors.length ? 'error' : 'ok');
      statusEl.textContent = r.outputs.summary;
    } else if (registry.engine && 'classes' in r.outputs) {
      const o = r.outputs as { classes: number; interfaces: number; enums: number; warnings: number };
      statusEl.setAttribute('data-state', o.warnings ? 'error' : 'ok');
      statusEl.textContent = `${o.classes} classes · ${o.interfaces} interfaces · ${o.enums} enums` + (o.warnings ? ` · ${o.warnings} warning${o.warnings > 1 ? 's' : ''}` : '');
    } else {
      statusEl.textContent = r.errors.length
        ? `${r.errors.length} error${r.errors.length > 1 ? 's' : ''}`
        : `${r.executed.length}/${graph.nodes.size} ran · ${r.durationMs.toFixed(r.durationMs < 10 ? 1 : 0)} ms`;
    }
    renderCall();
    if (building) renderIssues();
  });
  graph.on('change', () => {
    if (building) renderBuild();
    clearTimeout(saveTimer);
    const at = current;
    saveTimer = setTimeout(() => at && store.set(gtype.id, at.id, graph.toJSON()), 400);
  });
  buildTabs();
}

// Wire style and layout engine pickers.
wiresSel.addEventListener('change', () => editor.setWires(wiresSel.value as 'smart' | 'curved'));
let elk: Promise<LayoutEngine> | null = null;
function loadElk(): Promise<LayoutEngine> {
  // elkjs is ~1.5 MB, so the demo fetches it from a CDN only when someone picks it.
  return (elk ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/elkjs@0.12.1/lib/elk.bundled.js';
    s.onload = () => resolve(elkLayout(new (window as any).ELK()));
    s.onerror = () => {
      elk = null;
      reject(new Error('ELK could not be loaded'));
    };
    document.head.append(s);
  }));
}
engineSel.addEventListener('change', async () => {
  if (engineSel.value === 'elk') {
    statusEl.textContent = 'loading ELK…';
    try {
      layoutEngine = await loadElk();
      editor.setLayout(layoutEngine);
      statusEl.textContent = 'ELK ready';
      void editor.autoLayout();
    } catch (err) {
      engineSel.value = 'layered';
      editor.notify(err instanceof Error ? err.message : String(err));
    }
  } else {
    layoutEngine = layered();
    editor.setLayout(layoutEngine);
    void editor.autoLayout();
  }
});
typeSel.addEventListener('change', () => {
  const t = graphTypes.find((g) => g.id === typeSel.value)!;
  showTab(`${t.id}|${t.examples?.[0]?.id ?? ''}`);
});

const integrations: Record<string, { name: string; blurb: string; mount: (el: HTMLElement) => void; unmount?: () => void }> = {
  react: {
    name: 'React',
    blurb: '<NodeMap> with hooks. React state drives the map and reads its results.',
    mount: (el) => mountReact(el, demoMath.createRegistry()),
    unmount: unmountReact,
  },
  element: {
    name: '<node-map>',
    blurb: 'A custom element: one tag with inline JSON, events and methods. Set graph-type to switch what it edits.',
    mount: mountElement,
  },
};
let activeIntegration: string | null = null;

/** Tab ids are "graphType|example" for maps, or an integration id. */
function showTab(id: string) {
  if (activeIntegration) {
    integrations[activeIntegration].unmount?.();
    $('#alt').textContent = '';
    activeIntegration = null;
  }
  const integ = integrations[id];
  $('.app').dataset.mode = integ ? 'integration' : 'map';
  $('#canvas').hidden = !!integ;
  $('#alt').hidden = !integ;
  if (integ) {
    showPanel(null);
    activeIntegration = id;
    blurbEl.textContent = integ.blurb;
    integ.mount($('#alt'));
    markTab(id);
  } else {
    const [typeId, exId] = id.split('|');
    const t = graphTypes.find((g) => g.id === typeId) ?? demoMath;
    if (t !== gtype || !editor) startSession(t);
    loadExample(exId);
  }
  safe(() => localStorage.setItem('nodemap-demo:tab', id), undefined);
}

function markTab(id: string) {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.id === id)));
}

function loadExample(id: string, fresh = false) {
  current = examples.find((e) => e.id === id) ?? examples[0];
  editingType = undefined;
  buildName = gtype === demoFunction ? current.name : buildName;
  buildDesc = gtype === demoFunction ? current.description ?? '' : buildDesc;
  if (fresh) store.clear(gtype.id, current.id);
  let saved = store.get(gtype.id, current.id);
  // A map saved by an older version may use node types that have since been retired.
  if (saved && saved.nodes?.some((n) => !registry.get(n.type))) {
    store.clear(gtype.id, current.id);
    saved = null;
  }
  try {
    graph.load(structuredClone(saved ?? current.graph));
  } catch (err) {
    // A map saved by an older version (a node type that has since changed): start fresh.
    console.warn('Saved map could not be loaded; using the example', err);
    store.clear(gtype.id, current.id);
    saved = null;
    graph.load(structuredClone(current.graph));
  }
  editor.history?.reset();
  editor.select({});
  blurbEl.textContent = current.description ?? '';
  markTab(`${gtype.id}|${current.id}`);
  const tidy = !saved && gtype.editor?.autoLayout;
  requestAnimationFrame(() => (tidy ? void editor.autoLayout({ animate: false }) : editor.fit()));
}

const tabs = $('#tabs');
function buildTabs() {
  tabs.textContent = '';
  const tab = (id: string, label: string, cls = 'tab') => {
    const b = document.createElement('button');
    b.className = cls;
    b.type = 'button';
    b.role = 'tab';
    b.dataset.id = id;
    b.textContent = label;
    b.addEventListener('click', () => showTab(id));
    tabs.append(b);
  };
  for (const ex of examples) tab(`${gtype.id}|${ex.id}`, ex.name);
  const divider = document.createElement('span');
  divider.className = 'tab-divider';
  divider.setAttribute('aria-hidden', 'true');
  tabs.append(divider);
  for (const [id, integ] of Object.entries(integrations)) tab(id, integ.name, 'tab tab-integ');
}

// ------------------------------------------------------------------ panels

const panel = $('#panel');
const panelBody = $('#panel-body');
const panelTitle = $('#panel-title');
let openPanel: 'call' | 'json' | 'help' | 'build' | null = null;

function showPanel(kind: typeof openPanel) {
  openPanel = openPanel === kind ? null : kind;
  panel.hidden = !openPanel;
  const wide = matchMedia('(min-width: 900px)').matches;
  $('.app').classList.toggle('panel-open', !!openPanel);
  if (wide) requestAnimationFrame(() => editor.fit());
  document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.panel === openPanel)));
  if (openPanel === 'call') renderCall(true);
  if (openPanel === 'json') renderJson();
  if (openPanel === 'help') renderHelp();
  if (openPanel === 'build') renderBuild(true);
}
document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) =>
  b.addEventListener('click', () => showPanel(b.dataset.panel as typeof openPanel)),
);
$('#panel-close').addEventListener('click', () => showPanel(null));
$('#reset').addEventListener('click', () => loadExample(current.id, true));

const callArgs: Record<string, Record<string, unknown>> = {};
let callSeq = 0;

function renderCall(rebuild = false) {
  if (openPanel !== 'call') return;
  const sig = signature(graph);
  const args = (callArgs[current.id] ??= {});
  const key = JSON.stringify(sig);
  if (rebuild || panelBody.dataset.sig !== key) {
    panelBody.dataset.sig = key;
    panelTitle.textContent = 'Call this map as a function';
    panelBody.innerHTML = '';
    if (!sig.inputs.length && !sig.outputs.length) {
      panelBody.innerHTML = `<p class="note">This map has no <b>Graph input</b> or <b>Graph output</b> nodes yet. Add them from the Graph section of the add menu, or open the <b>Function</b> example.</p>`;
      return;
    }
    const form = document.createElement('form');
    form.className = 'call';
    form.innerHTML = `<pre class="code" id="call-code"></pre><div class="args"></div><div class="results" aria-live="polite"></div>`;
    form.addEventListener('submit', (e) => e.preventDefault());
    const argsEl = form.querySelector('.args')!;
    for (const p of sig.inputs) {
      const id = `arg-${p.name}`;
      const wrap = document.createElement('label');
      wrap.className = 'arg';
      wrap.htmlFor = id;
      const isNum = p.type === 'number';
      wrap.innerHTML = `<span>${escapeHtml(p.name)}<small>${escapeHtml(p.type ?? 'any')}</small></span><input id="${id}" ${isNum ? 'type="number" step="any" inputmode="decimal"' : 'type="text"'}>`;
      const input = wrap.querySelector('input')!;
      input.value = String(args[p.name] ?? p.default ?? '');
      input.addEventListener('input', () => {
        args[p.name] = isNum ? Number(input.value) : input.value;
        runCall();
      });
      argsEl.append(wrap);
    }
    panelBody.append(form);
  }
  runCall();
}

async function runCall() {
  const sig = signature(graph);
  const args = callArgs[current.id] ?? {};
  const code = panelBody.querySelector('#call-code');
  const res = panelBody.querySelector('.results');
  if (!code || !res) return;
  const argList = sig.inputs.map((p) => `${p.name}: ${formatValue(args[p.name] ?? p.default)}`).join(', ');
  code.textContent = `const fn = compile(graph, registry);\nawait fn({ ${argList} });`;
  const seq = ++callSeq;
  try {
    const t0 = performance.now();
    // compile() snapshots the graph, so the call never disturbs the live editor.
    const out = await compile(graph, registry)(args);
    if (seq !== callSeq) return;
    const ms = performance.now() - t0;
    res.innerHTML =
      `<div class="res-head"><span>returns</span><span>${ms.toFixed(1)} ms</span></div>` +
      sig.outputs.map((o) => `<div class="res"><span>${escapeHtml(o.name)}</span><output>${escapeHtml(formatValue(out[o.name], 200))}</output></div>`).join('');
  } catch (err) {
    if (seq !== callSeq) return;
    res.innerHTML = `<div class="res err">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

function renderJson() {
  panelTitle.textContent = 'Graph JSON';
  panelBody.innerHTML = `<p class="note">Everything the editor shows is plain data. Edit it or paste another map, then load it.</p>
    <textarea id="json-text" spellcheck="false" aria-label="Graph JSON"></textarea>
    <div class="row"><button type="button" class="btn" id="json-copy">Copy</button><button type="button" class="btn primary" id="json-load">Load JSON</button><span class="note" id="json-msg" role="status"></span></div>`;
  const ta = $<HTMLTextAreaElement>('#json-text');
  const msg = $('#json-msg');
  ta.value = JSON.stringify(graph.toJSON(), null, 2);
  $('#json-copy').addEventListener('click', () => {
    navigator.clipboard
      ?.writeText(ta.value)
      .then(() => (msg.textContent = 'Copied'))
      .catch(() => {
        ta.select();
        msg.textContent = 'Press Ctrl+C or ⌘C to copy';
      });
  });
  $('#json-load').addEventListener('click', () => {
    try {
      const json = JSON.parse(ta.value) as GraphJSON;
      if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) throw new Error('Expected { nodes: [], edges: [] }');
      const unknown = json.nodes.find((n) => !registry.get(n.type));
      if (unknown) throw new Error(`Unknown node type "${unknown.type}"`);
      graph.load(json);
      graph.topoSort();
      requestAnimationFrame(() => editor.fit());
      msg.textContent = 'Loaded';
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

// ------------------------------------------------------------------ function builder

let buildName = '';
let buildDesc = '';
/** Set while editing an existing library node: saving replaces it and keeps its type id. */
let editingType: string | undefined;

function issuesNow() {
  return graph.validate();
}

/** Builder status line: the first problem, or a ready signature. */
function renderIssues() {
  if (gtype !== demoFunction) return;
  const issues = issuesNow();
  const err = issues.find((i) => i.level === 'error');
  const sig = signature(graph);
  statusEl.setAttribute('data-state', err ? 'error' : 'ok');
  statusEl.textContent = err ? err.message : `ready · ${sig.inputs.length} input${sig.inputs.length === 1 ? '' : 's'} → 1 output`;
}

function renderBuild(rebuild = false) {
  renderIssues();
  if (openPanel !== 'build') return;
  panelTitle.textContent = editingType ? 'Edit a library node' : 'Build a custom node';
  if (rebuild || !panelBody.querySelector('#b-name')) {
    panelBody.innerHTML = `
      <p class="note">Input nodes are the new node's arguments, top to bottom. The one Output is its result.</p>
      <ul class="checks" id="b-checks" aria-live="polite"></ul>
      <div class="sig" id="b-sig"></div>
      <label class="field" for="b-name"><span>Name <span class="req">required</span></span><input id="b-name" autocomplete="off" spellcheck="false" placeholder="e.g. Cylinder volume" required></label>
      <label class="field" for="b-desc"><span>Description <span class="opt">optional</span></span><textarea id="b-desc" rows="2" placeholder="What it does, for the add menu"></textarea></label>
      <div class="row"><button type="button" class="btn primary" id="b-add">Add to library</button><span class="note" id="b-msg" role="status"></span></div>
      <h3 class="sub-h">As one TypeScript function</h3>
      <pre class="code" id="b-code"></pre>
      <div class="row"><button type="button" class="btn" id="b-copy">Copy code</button><span class="note" id="b-copied" role="status"></span></div>
      <h3 class="sub-h">Library</h3>
      <ul class="lib" id="b-lib"></ul>`;
    panelBody.scrollTop = 0;
    const nameEl = $<HTMLInputElement>('#b-name');
    const descEl = $<HTMLTextAreaElement>('#b-desc');
    nameEl.value = buildName;
    descEl.value = buildDesc;
    nameEl.addEventListener('input', () => {
      buildName = nameEl.value;
      renderBuild();
    });
    descEl.addEventListener('input', () => (buildDesc = descEl.value));
    $('#b-add').addEventListener('click', addToLibrary);
    $('#b-copy').addEventListener('click', () => {
      const text = $('#b-code').textContent ?? '';
      navigator.clipboard?.writeText(text).then(
        () => ($('#b-copied').textContent = 'Copied'),
        () => ($('#b-copied').textContent = 'Select the code and copy it'),
      );
    });
  }
  const name = $<HTMLInputElement>('#b-name').value.trim();
  const issues = issuesNow();
  const errors = issues.filter((i) => i.level === 'error');
  $('#b-checks').innerHTML = [
    ...issues.map((i) => `<li data-level="${i.level}">${escapeHtml(i.message)}</li>`),
    name ? '' : '<li data-level="error">Give the node a name</li>',
    !issues.length && name ? '<li data-level="ok">Ready to compile</li>' : '',
  ].join('');
  const sig = signature(graph);
  const outEdge = [...graph.nodes.values()].filter((n) => n.type === 'graph/output').map((o) => graph.incoming(o.id)[0])[0];
  const outType = outEdge ? registry.outputsOf(graph.nodes.get(outEdge.from.node)!).find((p) => p.name === outEdge.from.port)?.type ?? 'any' : '?';
  $('#b-sig').textContent = `${camel(name || 'unnamed')}(${sig.inputs.map((p) => `${p.name}: ${p.type}`).join(', ')}) → ${outType}`;
  const add = $('#b-add') as HTMLButtonElement;
  add.disabled = errors.length > 0 || !name;
  add.textContent = editingType ? 'Update in library' : 'Add to library';
  try {
    $('#b-code').textContent = errors.length ? 'Fix the problems above to see the code.' : emitSource(graph, registry, { name: camel(name || 'unnamed'), single: true });
  } catch (err) {
    $('#b-code').textContent = err instanceof Error ? err.message : String(err);
  }
  const lib = $('#b-lib');
  const entries = library.list();
  lib.innerHTML = entries.length ? '' : '<li><span class="note">Nothing yet. Added nodes appear here and in the add menu under Library.</span></li>';
  for (const e of entries) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(e.name)}<small>${escapeHtml(e.description ?? e.type)}</small></span>`;
    const ed = document.createElement('button');
    ed.type = 'button';
    ed.className = 'btn';
    ed.textContent = 'Edit';
    ed.addEventListener('click', () => library.edit(e.type));
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => {
      library.remove(e.type);
      if (editingType === e.type) editingType = undefined;
      refreshSession();
      renderBuild(true);
    });
    li.append(ed, rm);
    lib.append(li);
  }
}

function addToLibrary() {
  const name = $<HTMLInputElement>('#b-name').value.trim();
  const description = $<HTMLTextAreaElement>('#b-desc').value.trim();
  try {
    const node = library.add({ name, description: description || undefined, type: editingType }, graph, registry);
    const verb = editingType ? 'Updated' : 'Added';
    editingType = node.type;
    refreshSession();
    renderBuild(true);
    $('#b-msg').textContent = `${verb} “${name}”. Tap it in any map to see its code.`;
  } catch (err) {
    $('#b-msg').textContent = err instanceof Error ? err.message : String(err);
  }
}

// "Edit in graph" on a library node (from its details card, or the list above) opens its source graph here.
library.on('edit', (entry) => {
  if (activeIntegration) showTab(`${demoFunction.id}|${demoFunction.examples![0].id}`);
  if (gtype !== demoFunction) startSession(demoFunction);
  current = { id: `lib:${entry.type}`, name: entry.name, description: entry.description, graph: entry.graph };
  graph.load(structuredClone(entry.graph));
  editor.history?.reset();
  editingType = entry.type;
  buildName = entry.name;
  buildDesc = entry.description ?? '';
  blurbEl.textContent = `Editing “${entry.name}” from your library. Save to update every map that uses it.`;
  markTab('');
  requestAnimationFrame(() => editor.fit());
  if (openPanel !== 'build') showPanel('build');
  else renderBuild(true);
});

/** Rebuild the registry (to pick up library changes) without losing the map on screen. */
function refreshSession() {
  const json = graph.toJSON();
  const at = current;
  startSession(gtype);
  current = at;
  graph.load(json);
  markTab(`${gtype.id}|${current.id}`);
  requestAnimationFrame(() => editor.fit());
}

function renderHelp() {
  panelTitle.textContent = 'How to use it';
  panelBody.innerHTML = `
  <ul class="help">
    <li><b>Tip</b> the line under the tabs explains each example; × hides it (remembered), and <b>i</b> brings it back</li>
    <li><b>Graph type</b> the picker next to the logo switches what you are building: maths, a network, a UML class diagram, a drama production (wired, or as Drama boards: tabs of cards), or colour palettes from a third-party pack</li>
    <li><b>Pan</b> drag the background · <b>Zoom</b> pinch, or scroll with a trackpad</li>
    <li><b>Move</b> drag any node · <b>Select</b> tap it, then use the toolbar</li>
    <li><b>Go to a neighbour</b> zoomed in, connected nodes off screen show as chips on the screen edge: tap one to go there</li>
    <li><b>Fields</b> tap a node to select it, then tap its fields to edit them</li>
    <li><b>Edit</b> double-tap a node (or select it and tap the pencil) for big controls: rename it and change every setting</li>
    <li><b>Connect</b> drag from a port to a port, or tap one port and then another (or a node)</li>
    <li><b>Add</b> long-press the background, or press <kbd>+</kbd>. With a node, port or wire selected, <kbd>+</kbd> adds a node wired to it and nudges its neighbours aside</li>
    <li><b>Tidy</b> the layout button (or <kbd>L</kbd>) arranges the map in one roomy flow: left to right, or top to bottom on a portrait phone. Wires route around nodes</li>
    <li><b>Themes</b> pick one of three light and three dark themes. Node shapes and colours follow each node's flavor: sources, transforms, sinks, views and control</li>
    <li><b>Tabs</b> some graph types (Drama boards) are tabs of cards instead of one canvas. Grids open zoomed out: tap a card to zoom in. Name chips and list entries jump to their card, even on another tab; <b>← Back</b> returns</li>
    <li><b>Pickers</b> a card's “+ …” picker adds a reference; past 8 choices it opens a searchable list. On scenes and episodes, ‹ › reorder shots or scenes and the numbers follow</li>
    <li><b>Open a node</b> nodes made of a map (like Hypotenuse) have a <b>↘</b> button: it opens the map inside, running on the node's live inputs. Back (or <kbd>Esc</kbd>) returns</li>
    <li><b>Generate pictures</b> on a selected card, ✨ next to + opens a prompt written from the card (a character's appearance, a shot's framing and cast) and makes the picture with Meshy, using your own Meshy API key (kept in this browser only)</li>
    <li><b>Video</b> tap a drama shot, scene or episode twice for its Seedance script, and download it as a zip: one pack per shot with its numbered reference images</li>
    <li><b>Build your own node</b> in the λ Function builder: Inputs become arguments and the one Output is the result. <b>Build</b> adds it to your library and shows it as one TypeScript function</li>
  </ul>
  <p class="note">Everything here is a plug-in. A graph type picks the nodes, port types, rules and engine; a pack is what a library publishes.</p>
  <pre class="code">import { definePack, defineNode, defineGraphType, mathGraph } from 'mobile-nodemap';

export const unitsPack = definePack({
  id: 'acme/units',
  nodes: [defineNode({
    type: 'units/f-to-c', title: '°F → °C',
    inputs: { f: 'number' }, outputs: { c: 'number' },
    run: ({ f }) => ({ c: (f - 32) * 5 / 9 }),   // f is a number
  })],
});

export const lab = mathGraph.extend({
  id: 'acme/lab', title: 'Lab', packs: [unitsPack], exclude: ['async/*'],
});

// &lt;node-map graph-type="acme/lab"&gt; after registerGraphType(lab)</pre>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

void libraryStore.get('library').then((entries) => {
  if (entries) library.load(entries);
  let startTab = safe(() => localStorage.getItem('nodemap-demo:tab'), null) ?? `${demoMath.id}|waves`;
  const known = (id: string) => id in integrations || graphTypes.some((t) => t.examples?.some((e) => id === `${t.id}|${e.id}`));
  if (!known(startTab)) startTab = `${demoMath.id}|waves`;
  if (startTab in integrations) startSession(demoMath);
  showTab(startTab);
});
