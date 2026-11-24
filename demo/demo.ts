import {
  Graph,
  Registry,
  Evaluator,
  NodeEditor,
  stdlib,
  compile,
  graphNode,
  signature,
  defineNode,
  formatValue,
  type GraphJSON,
} from '../src/index.js';

// ------------------------------------------------------------------ registry

const registry = new Registry(stdlib);

// A node defined in plain TypeScript.
registry.define(
  defineNode({
    type: 'units/f-to-c',
    title: '°F → °C',
    category: 'Custom',
    color: '#be4bdb',
    description: 'A custom node written in TypeScript',
    inputs: [{ name: 'f', type: 'number', default: 72 }],
    outputs: [{ name: 'c', type: 'number' }],
    run: ({ f }) => ({ c: ((Number(f) - 32) * 5) / 9 }),
  }),
);

// A node defined *as a node map*: compile() turns the graph into a function and graphNode() wraps it.
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
registry.define(
  graphNode({ type: 'fn/hypot', title: 'Hypotenuse', category: 'Custom', color: '#be4bdb', graph: hypotGraph, registry }),
);
registry.get('fn/hypot')!.description = 'A node built from another node map';

// ------------------------------------------------------------------ examples

type Example = { id: string; name: string; blurb: string; graph: GraphJSON };
const N = (id: string, type: string, x: number, y: number, params: Record<string, unknown> = {}) => ({ id, type, x, y, params });
const E = (from: string, fp: string, to: string, tp: string) => ({ id: `${from}.${fp}-${to}.${tp}`, from: { node: from, port: fp }, to: { node: to, port: tp } });

const examples: Example[] = [
  {
    id: 'waves',
    name: 'Waves',
    blurb: 'Drag the frequency slider. Only the nodes downstream of it re-run.',
    graph: {
      version: 1,
      nodes: [
        N('range', 'list/range', 0, 0, { start: 0, end: 12.566, count: 120 }),
        N('freq', 'value/number', 0, 220, { value: 1.5 }),
        N('map', 'list/map', 270, 40, { expr: 'sin(x * k) + 0.4 * sin(x * k * 3)' }),
        N('plot', 'view/plot', 540, 0),
        N('stat', 'list/reduce', 540, 230, { op: 'max' }),
        N('show', 'view/display', 800, 240),
      ],
      edges: [
        E('range', 'list', 'map', 'list'),
        E('freq', 'value', 'map', 'k'),
        E('map', 'list', 'plot', 'value'),
        E('map', 'list', 'stat', 'list'),
        E('stat', 'out', 'show', 'value'),
      ],
    },
  },
  {
    id: 'function',
    name: 'Function',
    blurb: 'Graph inputs and outputs make this map callable. Open “Call” to run it with arguments.',
    graph: {
      version: 1,
      nodes: [
        N('r', 'graph/input', 0, 0, { name: 'radius', type: 'number', value: 2 }),
        N('h', 'graph/input', 0, 200, { name: 'height', type: 'number', value: 5 }),
        N('area', 'math/expression', 270, 0, { vars: 'r', expr: 'PI * r ** 2' }),
        N('vol', 'math/multiply', 520, 120),
        N('outA', 'graph/output', 790, 0, { name: 'area' }),
        N('outV', 'graph/output', 790, 170, { name: 'volume' }),
        N('label', 'text/template', 520, 300, { template: 'Cylinder volume {a} for height {b}' }),
        N('outL', 'graph/output', 790, 330, { name: 'label' }),
      ],
      edges: [
        E('r', 'value', 'area', 'r'),
        E('area', 'out', 'vol', 'a'),
        E('h', 'value', 'vol', 'b'),
        E('area', 'out', 'outA', 'value'),
        E('vol', 'out', 'outV', 'value'),
        E('vol', 'out', 'label', 'a'),
        E('h', 'value', 'label', 'b'),
        E('label', 'out', 'outL', 'value'),
      ],
    },
  },
  {
    id: 'async',
    name: 'Async',
    blurb: 'Delay nodes are async. Independent branches run in parallel and edits cancel stale runs.',
    graph: {
      version: 1,
      nodes: [
        N('t', 'value/text', 0, 0, { value: 'nodes on a phone' }),
        N('d1', 'async/delay', 260, -20, { ms: 900 }),
        N('case', 'text/case', 520, 0, { mode: 'title' }),
        N('rnd', 'value/random', 0, 230, { min: 1, max: 100 }),
        N('d2', 'async/delay', 260, 230, { ms: 450 }),
        N('tpl', 'text/template', 780, 120, { template: '{a} · lucky number {b}' }),
        N('out', 'view/display', 1040, 140),
      ],
      edges: [
        E('t', 'value', 'd1', 'in'),
        E('d1', 'out', 'case', 'text'),
        E('rnd', 'value', 'd2', 'in'),
        E('case', 'out', 'tpl', 'a'),
        E('d2', 'out', 'tpl', 'b'),
        E('tpl', 'out', 'out', 'value'),
      ],
    },
  },
  {
    id: 'custom',
    name: 'Custom nodes',
    blurb: '“°F → °C” is written in TypeScript. “Hypotenuse” is itself a node map.',
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
      edges: [
        E('f', 'value', 'conv', 'f'),
        E('conv', 'c', 'cmp', 'a'),
        E('hyp', 'c', 'cmp', 'b'),
        E('cmp', 'out', 'if', 'cond'),
        E('if', 'out', 'out', 'value'),
      ],
    },
  },
];

// ------------------------------------------------------------------ app

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const storeKey = (id: string) => `nodemap-demo:${id}`;
const store = {
  get(id: string): GraphJSON | null {
    try {
      const raw = localStorage.getItem(storeKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(id: string, json: GraphJSON) {
    try {
      localStorage.setItem(storeKey(id), JSON.stringify(json));
    } catch {
      /* storage unavailable */
    }
  },
  clear(id: string) {
    try {
      localStorage.removeItem(storeKey(id));
    } catch {
      /* storage unavailable */
    }
  },
};

const graph = new Graph(registry);
const evaluator = new Evaluator(graph, registry);
const editor = new NodeEditor($('#canvas'), { graph, registry, evaluator });

let current = examples[0];
const statusEl = $('#status');
const blurbEl = $('#blurb');

evaluator.on('start', () => statusEl.setAttribute('data-state', 'running'));
evaluator.on('done', (r) => {
  statusEl.setAttribute('data-state', r.errors.length ? 'error' : 'ok');
  statusEl.textContent = r.errors.length
    ? `${r.errors.length} error${r.errors.length > 1 ? 's' : ''}`
    : `${r.executed.length}/${graph.nodes.size} ran · ${r.durationMs.toFixed(r.durationMs < 10 ? 1 : 0)} ms`;
  renderCall();
});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
graph.on('change', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(current.id, graph.toJSON()), 400);
});

function loadExample(id: string, fresh = false) {
  current = examples.find((e) => e.id === id) ?? examples[0];
  if (fresh) store.clear(current.id);
  graph.load(structuredClone(store.get(current.id) ?? current.graph));
  editor.history?.reset();
  editor.select({});
  blurbEl.textContent = current.blurb;
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.id === current.id)));
  requestAnimationFrame(() => editor.fit());
  try {
    localStorage.setItem('nodemap-demo:tab', current.id);
  } catch {
    /* ignore */
  }
}

const tabs = $('#tabs');
for (const ex of examples) {
  const b = document.createElement('button');
  b.className = 'tab';
  b.type = 'button';
  b.role = 'tab';
  b.dataset.id = ex.id;
  b.textContent = ex.name;
  b.addEventListener('click', () => loadExample(ex.id));
  tabs.append(b);
}

// ------------------------------------------------------------------ panels

const panel = $('#panel');
const panelBody = $('#panel-body');
const panelTitle = $('#panel-title');
let openPanel: 'call' | 'json' | 'help' | null = null;

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

function renderHelp() {
  panelTitle.textContent = 'How to use it';
  panelBody.innerHTML = `
  <ul class="help">
    <li><b>Pan</b> drag the background · <b>Zoom</b> pinch, or scroll with a trackpad</li>
    <li><b>Move</b> drag any node · <b>Select</b> tap it, then use the toolbar</li>
    <li><b>Connect</b> drag from a port to a port, or tap one port and then another</li>
    <li><b>Rewire</b> drag a wire's end off an input · drop it on empty canvas to add a connected node</li>
    <li><b>Add</b> long-press the background, or press <kbd>+</kbd></li>
    <li><b>Delete a wire</b> tap it, then the bin</li>
  </ul>
  <pre class="code">import { Graph, Registry, Evaluator, NodeEditor, stdlib, defineNode } from 'mobile-nodemap';

const registry = new Registry(stdlib).define(defineNode({
  type: 'units/f-to-c', title: '°F → °C',
  inputs:  [{ name: 'f', type: 'number', default: 72 }],
  outputs: [{ name: 'c', type: 'number' }],
  run: ({ f }) => ({ c: (f - 32) * 5 / 9 }),
}));

const graph = new Graph(registry);
const evaluator = new Evaluator(graph, registry);
new NodeEditor(el, { graph, registry, evaluator });</pre>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

let startTab = examples[0].id;
try {
  startTab = localStorage.getItem('nodemap-demo:tab') ?? startTab;
} catch {
  /* ignore */
}
loadExample(startTab);
