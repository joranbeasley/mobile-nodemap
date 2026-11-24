import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NodeMap, useEvaluation, useEvaluator, useGraph, reactView, type NodeViewProps } from '../src/react/index.js';
import { defineNodeMapElement, type NodeMapElement } from '../src/element/index.js';
import { formatValue, type GraphJSON, type Registry } from '../src/index.js';

// ------------------------------------------------------------------ a node whose preview is a React component

function Gauge({ result, node }: NodeViewProps) {
  const v = Number(result?.outputs?.value ?? 0);
  const min = Number(node.params.min ?? 0);
  const max = Number(node.params.max ?? 100);
  const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  const a = Math.PI * (1 - t);
  const r = 46;
  const end = { x: 60 + r * Math.cos(a), y: 58 - r * Math.sin(a) };
  return (
    <svg viewBox="0 0 120 72" className="gauge" role="img" aria-label={`${formatValue(v)} on a ${min} to ${max} scale`}>
      <path d={`M14,58 A${r},${r} 0 0 1 106,58`} className="gauge-track" />
      {t > 0.001 && <path d={`M14,58 A${r},${r} 0 0 1 ${end.x.toFixed(1)},${end.y.toFixed(1)}`} className="gauge-fill" />}
      <text x="60" y="54" textAnchor="middle" className="gauge-value">{formatValue(v)}</text>
      <text x="14" y="70" textAnchor="middle" className="gauge-tick">{min}</text>
      <text x="106" y="70" textAnchor="middle" className="gauge-tick">{max}</text>
    </svg>
  );
}

export function defineDemoNodes(registry: Registry) {
  registry.define({
    type: 'view/gauge',
    title: 'Gauge',
    category: 'Display',
    color: '#2563eb',
    description: 'Preview rendered by a React component',
    params: [
      { name: 'min', kind: 'number', default: -10 },
      { name: 'max', kind: 'number', default: 40 },
    ],
    inputs: [{ name: 'value', type: 'number', default: 0, inline: false }],
    run: ({ value }) => ({ value }),
    view: reactView(Gauge),
  });
}

// ------------------------------------------------------------------ React tab

const weatherMap: GraphJSON = {
  version: 1,
  nodes: [
    { id: 'f', type: 'graph/input', x: 0, y: 0, params: { name: 'f', type: 'number', value: 70 } },
    { id: 'c', type: 'units/f-to-c', x: 0, y: 0, params: {} },
    { id: 'g', type: 'view/gauge', x: 0, y: 0, params: { min: -10, max: 40 } },
    { id: 'adv', type: 'math/expression', x: 0, y: 0, params: { vars: 'c', expr: 'c < 5 ? "Coat" : c < 16 ? "Jacket" : c < 26 ? "T-shirt" : "Shorts"' } },
    { id: 'oc', type: 'graph/output', x: 0, y: 0, params: { name: 'celsius' } },
    { id: 'oa', type: 'graph/output', x: 0, y: 0, params: { name: 'advice' } },
  ],
  edges: [
    { id: '1', from: { node: 'f', port: 'value' }, to: { node: 'c', port: 'f' } },
    { id: '2', from: { node: 'c', port: 'c' }, to: { node: 'g', port: 'value' } },
    { id: '3', from: { node: 'c', port: 'c' }, to: { node: 'adv', port: 'c' } },
    { id: '4', from: { node: 'c', port: 'c' }, to: { node: 'oc', port: 'value' } },
    { id: '5', from: { node: 'adv', port: 'out' }, to: { node: 'oa', port: 'value' } },
  ],
};

const reactSource = `function Weather() {
  const graph = useGraph(registry, weatherMap);
  const evaluator = useEvaluator(graph, registry);
  const [f, setF] = useState(70);
  const { outputs } = useEvaluation(evaluator, { f });

  return <>
    <input type="range" value={f}
      onChange={(e) => setF(+e.target.value)} />
    <p>{outputs.celsius} °C · {outputs.advice}</p>
    <NodeMap registry={registry} graph={graph}
      evaluator={evaluator} autoLayout />
  </>;
}`;

function Weather({ registry }: { registry: Registry }) {
  // Nodes start stacked at 0,0; autoLayout places them on mount.
  const graph = useGraph(registry, weatherMap);
  const evaluator = useEvaluator(graph, registry);
  const [f, setF] = useState(70);
  const { outputs, running } = useEvaluation(evaluator, { f });
  const c = outputs.celsius as number | undefined;
  return (
    <div className="integ">
      <section className="integ-side">
        <label className="slider" htmlFor="rx-f">
          <span>Outdoor temperature</span>
          <output htmlFor="rx-f">{f} °F</output>
        </label>
        <input id="rx-f" type="range" min={0} max={110} value={f} onChange={(e) => setF(Number(e.target.value))} />
        <div className="readout" aria-live="polite" data-busy={running}>
          <span className="big">{c === undefined ? '—' : `${c.toFixed(1)} °C`}</span>
          <span className="chip">{String(outputs.advice ?? '…')}</span>
        </div>
        <p className="note">
          The slider and the readout are React state. The slider feeds the map's <code>f</code> input and the readout
          comes from its outputs through <code>useEvaluation()</code>. The gauge inside the map is a React component,
          drawn with <code>reactView()</code>.
        </p>
      </section>
      <div className="integ-map">
        <NodeMap registry={registry} graph={graph} evaluator={evaluator} autoLayout />
      </div>
      <section className="integ-code">
        <pre className="code">{reactSource}</pre>
      </section>
    </div>
  );
}

let reactRoot: Root | null = null;
export function mountReact(el: HTMLElement, registry: Registry) {
  reactRoot = createRoot(el);
  reactRoot.render(<Weather registry={registry} />);
}
export function unmountReact() {
  reactRoot?.unmount();
  reactRoot = null;
}

// ------------------------------------------------------------------ <node-map> tab

const elementMap: GraphJSON = {
  version: 1,
  nodes: [
    { id: 't', type: 'value/text', x: 0, y: 0, params: { value: 'web components' } },
    { id: 'u', type: 'text/case', x: 0, y: 0, params: { mode: 'upper' } },
    { id: 'n', type: 'text/length', x: 0, y: 0, params: {} },
    { id: 'tp', type: 'text/template', x: 0, y: 0, params: { template: '{a} has {b} letters' } },
    { id: 'd', type: 'view/display', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: '1', from: { node: 't', port: 'value' }, to: { node: 'u', port: 'text' } },
    { id: '2', from: { node: 't', port: 'value' }, to: { node: 'n', port: 'in' } },
    { id: '3', from: { node: 'u', port: 'out' }, to: { node: 'tp', port: 'a' } },
    { id: '4', from: { node: 'n', port: 'out' }, to: { node: 'tp', port: 'b' } },
    { id: '5', from: { node: 'tp', port: 'out' }, to: { node: 'd', port: 'value' } },
  ],
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function mountElement(el: HTMLElement) {
  defineNodeMapElement();
  const json = JSON.stringify(elementMap);
  const markup = `<node-map wires="smart" auto-layout>\n  <script type="application/json">\n    ${json.slice(0, 46)}…\n  </script>\n</node-map>`;
  el.innerHTML = `
    <div class="integ">
      <section class="integ-side">
        <p class="note">One tag, no framework. The map is read from the JSON inside the element and drawn in a shadow root. Page CSS variables still theme it.</p>
        <div class="row"><button type="button" class="btn" id="el-tidy">autoLayout()</button><button type="button" class="btn" id="el-curve">Toggle wires</button></div>
        <h3 class="log-title">Events</h3>
        <ol class="log" id="el-log" aria-live="polite"><li><span>Edit the map to see events</span></li></ol>
      </section>
      <div class="integ-map"><node-map id="demo-el" wires="smart" auto-layout><script type="application/json">${json}</script></node-map></div>
      <section class="integ-code">
        <pre class="code">${esc(markup)}</pre>
        <pre class="code">${esc(`const map = document.querySelector('node-map');
map.addEventListener('evaluate', (e) => …);
await map.call({});   // run as a function
map.autoLayout();     // tidy`)}</pre>
      </section>
    </div>`;
  const map = el.querySelector('#demo-el') as NodeMapElement;
  const log = el.querySelector('#el-log')!;
  const add = (type: string, text: string) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${type}</b> <span>${esc(text)}</span>`;
    log.prepend(li);
    while (log.children.length > 6) log.lastElementChild!.remove();
  };
  map.addEventListener('evaluate', (e) => {
    const r = (e as CustomEvent).detail;
    const display = [...r.results.entries()].find(([id]: [string]) => id === 'd')?.[1];
    add('evaluate', `${r.executed.length} ran · ${formatValue(display?.outputs?.value, 40)}`);
  });
  map.addEventListener('change', (e) => {
    const c = (e as CustomEvent).detail.change;
    if (c.kind !== 'node:move') add('change', c.kind + (c.name ? ` ${c.name}` : ''));
  });
  map.addEventListener('select', (e) => {
    const s = (e as CustomEvent).detail;
    if (s.node || s.edge) add('select', s.node ? `node ${s.node}` : `wire ${s.edge}`);
  });
  el.querySelector('#el-tidy')!.addEventListener('click', () => void map.autoLayout());
  el.querySelector('#el-curve')!.addEventListener('click', () =>
    map.setAttribute('wires', map.getAttribute('wires') === 'curved' ? 'smart' : 'curved'),
  );
}
