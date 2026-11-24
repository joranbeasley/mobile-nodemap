// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Registry } from '../src/core';
import { stdlib } from '../src/runtime';
import { defineNodeMapElement, NodeMapElement } from '../src/element';
import { NodeMap, useEvaluation, useEvaluator, useGraph, reactView } from '../src/react';
import type { GraphJSON } from '../src/core';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sum: GraphJSON = {
  version: 1,
  nodes: [
    { id: 'x', type: 'graph/input', x: 0, y: 0, params: { name: 'x', type: 'number', value: 2 } },
    { id: 'm', type: 'math/multiply', x: 240, y: 0, params: { b: 10 } },
    { id: 'o', type: 'graph/output', x: 480, y: 0, params: { name: 'y' } },
  ],
  edges: [
    { id: 'a', from: { node: 'x', port: 'value' }, to: { node: 'm', port: 'a' } },
    { id: 'b', from: { node: 'm', port: 'out' }, to: { node: 'o', port: 'value' } },
  ],
};

describe('<node-map>', () => {
  it('reads inline JSON, renders in its shadow root, evaluates and can be called', async () => {
    defineNodeMapElement();
    const el = document.createElement('node-map') as NodeMapElement;
    el.innerHTML = `<script type="application/json">${JSON.stringify(sum)}</script>`;
    const reports: unknown[] = [];
    el.addEventListener('evaluate', (e) => reports.push((e as CustomEvent).detail));
    document.body.append(el);
    expect(el.shadowRoot!.querySelectorAll('.nm-node')).toHaveLength(3);
    expect(el.shadowRoot!.querySelector('#nm-styles')).not.toBeNull();
    await wait(80);
    expect((reports.at(-1) as any).outputs).toEqual({ y: 20 });
    expect(await el.call({ x: 4 })).toEqual({ y: 40 });

    const changes: unknown[] = [];
    el.addEventListener('change', (e) => changes.push(e));
    el.graph!.setParam('m', 'b', 3);
    expect(changes).toHaveLength(1);
    el.setAttribute('wires', 'curved');
    expect(el.editor!.wireMode).toBe('curved');
    el.remove();
  });
});

describe('React', () => {
  it('renders NodeMap and drives it from React state', async () => {
    const registry = new Registry(stdlib);
    let seen: any;
    function App({ x }: { x: number }) {
      const graph = useGraph(registry, sum);
      const evaluator = useEvaluator(graph, registry);
      seen = useEvaluation(evaluator, { x });
      return (
        <div style={{ height: 400 }}>
          <NodeMap registry={registry} graph={graph} evaluator={evaluator} />
        </div>
      );
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<App x={5} />));
    await act(() => wait(80));
    expect(host.querySelectorAll('.nm-node')).toHaveLength(3);
    expect(seen.outputs).toEqual({ y: 50 });
    await act(async () => root.render(<App x={7} />));
    await act(() => wait(80));
    expect(seen.outputs).toEqual({ y: 70 });
    await act(async () => root.unmount());
    expect(host.querySelector('.nm-node')).toBeNull();
  });

  it('renders node previews with React components', async () => {
    const registry = new Registry(stdlib);
    registry.define({
      type: 'view/badge',
      inputs: [{ name: 'value', type: 'any', default: 'hi' }],
      run: ({ value }) => ({ value }),
      view: reactView(({ result }) => <b className="badge">{String(result?.outputs?.value)}</b>),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const value: GraphJSON = { version: 1, nodes: [{ id: 'b', type: 'view/badge', x: 0, y: 0, params: { value: 'ok!' } }], edges: [] };
    await act(async () => root.render(<NodeMap registry={registry} defaultValue={value} />));
    await act(() => wait(80));
    expect(host.querySelector('.badge')?.textContent).toBe('ok!');
    await act(async () => root.unmount());
  });
});
