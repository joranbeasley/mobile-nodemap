// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Registry, Evaluator, NodeEditor, mathGraph, graphNode, definePack, defineNode, compileNode, type EditorPlugin, type GraphJSON } from '../src/index';

const hypot: GraphJSON = {
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
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const mount = (reg: Registry, g: Graph, extra: Partial<ConstructorParameters<typeof NodeEditor>[1]> = {}) => {
  const el = document.createElement('div');
  document.body.append(el);
  const evaluator = new Evaluator(g, reg);
  return { el, evaluator, editor: new NodeEditor(el, { graph: g, registry: reg, evaluator, ...extra }) };
};

describe('Editor plugins', () => {
  it('installs plugins from packs and options, once each, and undoes them on destroy', () => {
    const log: string[] = [];
    const plugin = (id: string): EditorPlugin<NodeEditor> => ({
      id,
      install: (editor) => {
        log.push(`in:${id}`);
        const off = editor.addToolbarButton({ id, label: `Do ${id}`, icon: '★', run: () => log.push(`run:${id}`) });
        return () => {
          off();
          log.push(`out:${id}`);
        };
      },
    });
    const reg = new Registry().use(definePack({ id: 'p', nodes: [defineNode({ type: 't/x' })], editorPlugins: [plugin('a')] }));
    const { el, editor } = mount(reg, new Graph(reg), { plugins: [plugin('b'), plugin('a')] });
    expect(log).toEqual(['in:a', 'in:b']);
    const btn = el.querySelector<HTMLButtonElement>('[data-action="b"]')!;
    expect(btn.nextElementSibling?.getAttribute('data-action')).toBe('plus'); // just before +
    btn.click();
    expect(log).toContain('run:b');
    editor.destroy();
    expect(log.slice(-2).sort()).toEqual(['out:a', 'out:b']);
  });

  it('lets a view bring its own layout function', async () => {
    const reg = new Registry().use(definePack({ id: 'p', nodes: [defineNode({ type: 't/card' })] }));
    const g = new Graph(reg);
    ['x', 'y', 'z'].forEach((id) => g.addNode('t/card', { id }));
    const { editor } = mount(reg, g, {
      views: [{ id: 'diag', title: 'Diagonal', types: ['t/card'], layout: (nodes) => Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 100, y: i * 100 }])) }],
    });
    await editor.layoutView({ animate: false });
    expect(['x', 'y', 'z'].map((id) => [g.nodes.get(id)!.x, g.nodes.get(id)!.y])).toEqual([
      [0, 0],
      [100, 100],
      [200, 200],
    ]);
    editor.destroy();
  });
});

describe('Nodes made of maps', () => {
  const setup = () => {
    const reg = mathGraph.createRegistry();
    reg.define(graphNode({ type: 'fn/hypot', title: 'Hypotenuse', graph: hypot, registry: reg }));
    const g = new Graph(reg);
    g.addNode('fn/hypot', { id: 'h', params: { a: 6, b: 8 } });
    return { reg, g, ...mount(reg, g) };
  };

  it('opens the map inside on the node’s live inputs', async () => {
    const { el, editor, evaluator } = setup();
    await evaluator.run();
    expect(el.querySelector('.nm-node[data-id="h"] .nm-enter')).toBeTruthy();
    const inner = editor.enterNode('h')!;
    await tick();
    expect(el.querySelector('.nm-sublayer .nm-crumbs')!.textContent).toContain('Hypotenuse');
    expect(inner.graph.nodes.size).toBe(4);
    const innerResult = (inner as unknown as { evaluator: Evaluator }).evaluator.results.get('o');
    expect(innerResult?.outputs?.value).toBe(10);
    editor.leaveNode();
    expect(el.querySelector('.nm-sublayer')).toBeNull();
    editor.destroy();
  });

  it('saves edits inside to the node type', async () => {
    const { el, g, editor, evaluator } = setup();
    await evaluator.run();
    expect(evaluator.results.get('h')!.outputs!.c).toBe(10);
    const inner = editor.enterNode('h')!;
    inner.graph.setParam('e', 'expr', 'a + b');
    await tick(400);
    await evaluator.run();
    expect(evaluator.results.get('h')!.outputs!.c).toBe(14);
    // A map without an Output is refused, and the node keeps working as it was.
    inner.graph.removeNode('o');
    await tick(400);
    await evaluator.run();
    expect(evaluator.results.get('h')!.outputs!.c).toBe(14);
    expect(el.querySelector('.nm-sublayer .nm-toast')!.textContent).toMatch(/Output/);
    // A bad expression is an error when the node runs.
    inner.history?.undo();
    inner.graph.setParam('e', 'expr', 'a +');
    await tick(400);
    await evaluator.run();
    expect(evaluator.results.get('h')!.status).toBe('error');
    editor.leaveNode();
    expect(g.nodes.get('h')).toBeTruthy();
    expect(el.querySelector('.nm-sublayer')).toBeNull();
    editor.destroy();
  });

  it('library nodes open read-only', () => {
    const reg = mathGraph.createRegistry();
    const t = compileNode(hypot, reg, { name: 'Hyp' });
    const sub = t.subgraph!({ id: 'x', type: t.type, x: 0, y: 0, params: {} })!;
    expect(sub.graph.nodes).toHaveLength(4);
    expect(sub.save).toBeUndefined();
  });
});
