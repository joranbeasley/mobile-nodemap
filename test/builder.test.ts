// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  Graph,
  NodeEditor,
  Evaluator,
  compile,
  compileFunction,
  emitSource,
  functionGraph,
  mathGraph,
  compileNode,
  NodeLibrary,
  ConnectionError,
  registryRunner,
  memoryStore,
  dataflowEngine,
  listThemes,
  getTheme,
  flavorOf,
  defineTheme,
  type GraphJSON,
} from '../src/index';

const example = (id: string) => functionGraph.examples!.find((e) => e.id === id)!.graph;

describe('compile', () => {
  it('returns one plain function', async () => {
    const reg = functionGraph.createRegistry();
    const fn = compile(example('cylinder'), reg, 'cylinder');
    expect(typeof fn).toBe('function');
    expect(Object.keys(fn)).toEqual([]);
    expect(fn.name).toBe('cylinder');
    const out = await fn({ radius: 1, height: 2 });
    expect(out.volume).toBeCloseTo(2 * Math.PI);
  });

  it('compileFunction returns the single output directly and reports failing nodes', async () => {
    const reg = functionGraph.createRegistry();
    const vol = compileFunction<{ radius: number; height: number }, number>(example('cylinder'), reg);
    expect(await vol({ radius: 2, height: 5 })).toBeCloseTo(20 * Math.PI);
    const bad: GraphJSON = {
      version: 1,
      nodes: [
        { id: 'd', type: 'math/divide', x: 0, y: 0, params: { a: 1, b: 0 } },
        { id: 'o', type: 'graph/output', x: 200, y: 0, params: { name: 'x' } },
      ],
      edges: [{ id: 'e', from: { node: 'd', port: 'out' }, to: { node: 'o', port: 'value' } }],
    };
    await expect(compileFunction(bad, reg)()).rejects.toMatchObject({ name: 'NodeRunError', nodeId: 'd' });
  });
});

describe('emitSource', () => {
  it('inlines emit-capable nodes into one standalone function', async () => {
    const reg = functionGraph.createRegistry();
    const src = emitSource(example('cylinder'), reg, { name: 'cylinderVolume', lang: 'js', single: true });
    expect(src).toContain('export async function cylinderVolume(inputs = {})');
    expect(src).toContain('Self-contained');
    expect(src).not.toContain('runner');
    const fn = new Function(`${src.replace('export ', '')}; return cylinderVolume;`)();
    expect(await fn({ radius: 2, height: 5 })).toBeCloseTo(20 * Math.PI);
  });

  it('calls other nodes through a NodeRunner port', async () => {
    const reg = mathGraph.createRegistry();
    const json: GraphJSON = {
      version: 1,
      nodes: [
        { id: 'i', type: 'graph/input', x: 0, y: 0, params: { name: 'text', type: 'string', value: 'hi' } },
        { id: 'c', type: 'text/case', x: 200, y: 0, params: { mode: 'upper' } },
        { id: 'o', type: 'graph/output', x: 400, y: 0, params: { name: 'loud' } },
      ],
      edges: [
        { id: '1', from: { node: 'i', port: 'value' }, to: { node: 'c', port: 'text' } },
        { id: '2', from: { node: 'c', port: 'out' }, to: { node: 'o', port: 'value' } },
      ],
    };
    const ts = emitSource(json, reg, { name: 'shout' });
    expect(ts).toContain('runner: NodeRunner');
    expect(ts).toContain('inputs: { text?: string }');
    const js = emitSource(json, reg, { name: 'shout', lang: 'js' });
    const fn = new Function(`${js.replace('export ', '')}; return shout;`)();
    expect(await fn({ text: 'hey' }, registryRunner(reg))).toEqual({ loud: 'HEY' });
  });
});

describe('Function builder', () => {
  it('allows exactly one Output and explains what is wrong', () => {
    const reg = functionGraph.createRegistry();
    const g = new Graph(reg);
    expect(g.validate().map((i) => i.message)).toContain('Add an Output node: a function returns exactly one value');
    const out = g.addNode('graph/output', { params: { name: 'y' } });
    expect(() => g.addNode('graph/output')).toThrow(ConnectionError);
    expect(g.validate().some((i) => i.message.startsWith('Connect a value'))).toBe(true);
    const x = g.addNode('graph/input', { params: { name: 'x', type: 'number', value: 1 } });
    g.addNode('graph/input', { params: { name: 'x', type: 'number', value: 1 } });
    g.connect({ node: x.id, port: 'value' }, { node: out.id, port: 'value' });
    expect(g.validate().map((i) => i.message)).toContain('Two inputs are called "x"');
    expect(reg.get('graph/input')!.title).toBe('Input');
  });

  it('compiles to a node type that goes into a library and runs in other maps', async () => {
    const builder = functionGraph.createRegistry();
    const lib = new NodeLibrary();
    const changes: unknown[] = [];
    lib.on('change', (l) => changes.push(l));
    const node = lib.add({ type: 'lib/cylinder', title: 'Cylinder volume' }, example('cylinder'), builder);
    expect(node.inputs!.map((p) => p.name)).toEqual(['radius', 'height']);
    expect(node.outputs).toEqual([{ name: 'volume', type: 'number' }]);
    expect(changes).toHaveLength(1);

    // Install the library into a different graph type and use the node there.
    const reg = mathGraph.createRegistry().use(lib.toPack());
    expect(reg.get('lib/cylinder')!.category).toBe('Library');
    const g = new Graph(reg);
    g.addNode('lib/cylinder', { id: 'c', params: { radius: 1, height: 3 } });
    const r = await new Evaluator(g, reg).run();
    expect(r.results.get('c')!.outputs!.volume).toBeCloseTo(3 * Math.PI);

    // Libraries are plain JSON and can be stored through a StoragePort adapter.
    const store = memoryStore<ReturnType<NodeLibrary['toJSON']>>();
    await store.put('lib', lib.toJSON());
    const again = NodeLibrary.fromJSON((await store.get('lib'))!);
    expect(again.list().map((e) => e.type)).toEqual(['lib/cylinder']);
    expect(again.source('lib/cylinder', builder)).toContain('async function cylinderVolume(');
  });

  it('refuses to compile a map with errors', () => {
    const reg = functionGraph.createRegistry();
    expect(() => compileNode({ version: 1, nodes: [], edges: [] }, reg, { type: 'x', title: 'X' })).toThrow(/Output/);
  });
});

describe('Ports and adapters', () => {
  it('dataflowEngine runs a map like the evaluator', async () => {
    const reg = functionGraph.createRegistry();
    reg.engine = dataflowEngine;
    const g = Graph.fromJSON(example('bmi'), reg);
    const r = await new Evaluator(g, reg).run();
    expect(r.outputs).toEqual({ bmi: 22.9 });
    expect(r.results.get('e')!.status).toBe('ok');
  });
});

describe('Themes and flavors', () => {
  it('ships light and dark themes', () => {
    const t = listThemes();
    expect(t.filter((x) => x.mode === 'light').length).toBeGreaterThanOrEqual(3);
    expect(t.filter((x) => x.mode === 'dark').length).toBeGreaterThanOrEqual(3);
  });

  it('infers flavors from ports, and nodes can set their own', () => {
    const reg = mathGraph.createRegistry();
    const f = (type: string) => flavorOf(reg.get(type), reg.inputsOf({ type, params: {} }), reg.outputsOf({ type, params: {} }));
    expect(f('value/number')).toBe('source');
    expect(f('math/add')).toBe('transform');
    expect(f('view/display')).toBe('view');
    expect(f('graph/output')).toBe('sink');
    expect(f('logic/if')).toBe('control');
  });

  it('applies a theme to the editor and marks node flavors', () => {
    const reg = mathGraph.createRegistry();
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'n' });
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg, theme: 'synthwave' });
    expect(el.dataset.nmTheme).toBe('synthwave');
    expect(el.dataset.nmHeader).toBe('solid');
    expect(el.dataset.theme).toBe('dark');
    expect(document.getElementById('nm-pack-theme-synthwave')!.textContent).toContain('--nm-bg: #140b26');
    expect(el.querySelector<HTMLElement>('[data-id="n"]')!.dataset.flavor).toBe('source');
    editor.setTheme(defineTheme({ ...getTheme('paper')!, id: 'custom-paper', flavors: { ...getTheme('paper')!.flavors, source: 'red' } }));
    expect(el.dataset.nmTheme).toBe('custom-paper');
    editor.setTheme(null);
    expect(el.dataset.nmTheme).toBeUndefined();
    editor.destroy();
  });
});
