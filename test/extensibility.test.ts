// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  Graph,
  Registry,
  Evaluator,
  NodeEditor,
  defineNode,
  extendNode,
  definePack,
  defineGraphType,
  registerGraphType,
  getGraphType,
  registryFor,
  mathGraph,
  networkGraph,
  deviceSpecs,
  defineNodeMapElement,
  type NodeMapElement,
} from '../src/index';

const run = async (g: Graph) => new Evaluator(g, g.registry!).run();

describe('Node authoring', () => {
  it('accepts shorthand ports and normalises them', async () => {
    const lerp = defineNode({
      type: 't/lerp',
      inputs: { a: 'number', b: 'number', t: { type: 'number', default: 0.5 } },
      outputs: { out: 'number' },
      run: ({ a, b, t }) => ({ out: a + (b - a) * t }),
    });
    expect(lerp.inputs!.map((p) => [p.name, p.type])).toEqual([['a', 'number'], ['b', 'number'], ['t', 'number']]);
    const g = new Graph(new Registry([lerp]));
    g.addNode('t/lerp', { id: 'l', params: { a: 10, b: 20 } });
    expect((await run(g)).results.get('l')!.outputs!.out).toBe(15);
  });

  it('extends a node type, merging params and ports by name', () => {
    const base = defineNode({ type: 't/base', inputs: { x: 'number' }, params: [{ name: 'k', kind: 'number', default: 1 }] });
    const child = extendNode(base, { type: 't/child', inputs: { y: 'string' }, params: [{ name: 'k', kind: 'number', default: 5 }] });
    expect(child.inputs!.map((p) => p.name)).toEqual(['x', 'y']);
    expect(child.params).toHaveLength(1);
    expect((child.params![0] as { default: number }).default).toBe(5);
  });

  it('collects every wire into a `multiple` input, top to bottom', async () => {
    const reg = mathGraph.createRegistry();
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'a', y: 100, params: { value: 2 } });
    g.addNode('value/number', { id: 'b', y: 0, params: { value: 3 } });
    g.addNode('math/sum', { id: 's' });
    g.connect({ node: 'a', port: 'value' }, { node: 's', port: 'values' });
    g.connect({ node: 'b', port: 'value' }, { node: 's', port: 'values' });
    expect(g.incoming('s')).toHaveLength(2);
    const r = await run(g);
    expect(r.results.get('s')!.outputs!.out).toBe(5);
    expect(new Evaluator(g, reg).inputValues(g.nodes.get('s')!, r.results).values).toEqual([3, 2]);
  });

  it('runs onCreate and migrates old params on load', () => {
    const t = defineNode({
      type: 't/v',
      version: 2,
      onCreate: () => ({ createdBy: 'test' }),
      migrate: (p, from) => (from < 2 ? { size: Number(p.width ?? 0) * 2 } : p),
    });
    const reg = new Registry([t]);
    const g = new Graph(reg);
    const n = g.addNode('t/v');
    expect(n.params.createdBy).toBe('test');
    expect(n.v).toBe(2);
    g.load({ version: 1, nodes: [{ id: 'old', type: 't/v', x: 0, y: 0, params: { width: 4 } }], edges: [] });
    expect(g.nodes.get('old')!.params).toEqual({ size: 8 });
  });
});

describe('Packs', () => {
  const colorPack = definePack({
    id: 'test/color',
    portTypes: [{ id: 'color', color: '#e64980', accepts: ['string'], coerce: (v) => String(v).toLowerCase(), inline: 'swatch' }],
    paramKinds: [
      {
        kind: 'swatch',
        render: ({ value, set, key }) => {
          const i = document.createElement('input');
          i.type = 'color';
          i.dataset.key = key;
          i.value = String(value ?? '#000000');
          i.addEventListener('input', () => set(i.value));
          return i;
        },
      },
    ],
    nodes: [defineNode({ type: 'c/echo', inputs: { c: 'color' }, outputs: { c: 'color' }, run: ({ c }) => ({ c }) })],
    css: '.c-test { color: red }',
  });

  it('adds port types that accept and convert other types', async () => {
    const reg = mathGraph.createRegistry().use(colorPack);
    expect(reg.isCompatible('string', 'color')).toBe(true);
    expect(reg.isCompatible('number', 'color')).toBe(false);
    const g = new Graph(reg);
    g.addNode('value/text', { id: 't', params: { value: '#FF0000' } });
    g.addNode('c/echo', { id: 'e' });
    g.connect({ node: 't', port: 'value' }, { node: 'e', port: 'c' });
    expect((await run(g)).results.get('e')!.outputs!.c).toBe('#ff0000');
    expect(reg.packs).toContain('test/color');
  });

  it('renders custom param kinds, port colours and pack CSS in the editor', () => {
    const reg = new Registry().use(colorPack);
    const g = new Graph(reg);
    g.addNode('c/echo', { id: 'e', params: { c: '#123456' } });
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    const swatch = el.querySelector<HTMLInputElement>('[data-param-kind="swatch"]')!;
    expect(swatch.type).toBe('color');
    expect(swatch.value).toBe('#123456');
    expect(el.querySelector<HTMLElement>('.nm-port[data-type="color"]')!.style.getPropertyValue('--nm-port-color')).toBe('#e64980');
    expect(document.getElementById('nm-pack-test_color')!.textContent).toContain('.c-test');
    editor.destroy();
  });
});

describe('Graph types', () => {
  it('compose: extends, packs, exclude, rules', () => {
    const lean = mathGraph.extend({ id: 't/lean', title: 'Lean math', exclude: ['async/*', 'text/*'] });
    const reg = lean.createRegistry();
    expect(reg.id).toBe('t/lean');
    expect(reg.get('math/add')).toBeTruthy();
    expect(reg.get('async/delay')).toBeUndefined();
    expect(reg.get('text/case')).toBeUndefined();
    expect(new Graph(reg).toJSON().type).toBe('t/lean');
  });

  it('veto connections with rules and allow loops when asked', () => {
    const reg = networkGraph.createRegistry();
    const g = new Graph(reg);
    g.addNode('net/internet', { id: 'i' });
    g.addNode('net/laptop', { id: 'l' });
    g.addNode('net/switch', { id: 'a' });
    g.addNode('net/switch', { id: 'b' });
    expect(g.canConnect({ node: 'i', port: 'wan' }, { node: 'l', port: 'uplink' })).toMatch(/through a router/);
    g.connect({ node: 'a', port: 'ports' }, { node: 'b', port: 'uplink' });
    expect(g.canConnect({ node: 'b', port: 'ports' }, { node: 'a', port: 'uplink' })).toBeNull(); // a loop is fine here
  });

  it('are found by id for saved maps and elements', () => {
    const custom = registerGraphType(defineGraphType({ id: 't/custom', title: 'Custom', extends: ['math'] }));
    expect(getGraphType('t/custom')).toBe(custom);
    expect(registryFor({ version: 1, type: 't/custom', nodes: [], edges: [] }).get('math/add')).toBeTruthy();
    expect(() => registryFor({ version: 1, type: 'nope', nodes: [], edges: [] })).toThrow(/Unknown graph type/);
  });

  it('<node-map graph-type="network"> uses the network graph type', async () => {
    defineNodeMapElement();
    const el = document.createElement('node-map') as NodeMapElement;
    el.setAttribute('graph-type', 'network');
    document.body.append(el);
    expect(el.registry.id).toBe('network');
    expect(el.registry.engine).toBeTruthy();
    el.remove();
  });
});

describe('Network engine', () => {
  const load = (id: string) => {
    const reg = networkGraph.createRegistry();
    return Graph.fromJSON(networkGraph.examples!.find((e) => e.id === id)!.graph, reg);
  };
  const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.results.get(id)!.outputs!.status as any;

  it('finds latency, hops and bandwidth to the internet', async () => {
    const g = load('home');
    const r = await run(g);
    expect(status(r, 'desk')).toMatchObject({ state: 'online', hops: 4 });
    expect(status(r, 'lap').bandwidth).toBe(300);
    expect(status(r, 'desk').redundant).toBe(false);
    expect(r.outputs.online).toBe(4);
  });

  it('takes devices offline when something upstream is off or blocking', async () => {
    const g = load('home');
    g.setParam('ap', 'up', false);
    let r = await run(g);
    expect(status(r, 'ap').state).toBe('down');
    expect(status(r, 'phone').state).toBe('offline');
    expect(r.results.get('phone')!.status).toBe('error');
    expect(status(r, 'desk').state).toBe('online');
    g.setParam('fw', 'allow', false);
    r = await run(g);
    expect(status(r, 'desk').state).toBe('offline');
  });

  it('spots redundant paths through loops', async () => {
    const g = load('office');
    let r = await run(g);
    expect(status(r, 'web').redundant).toBe(true);
    expect(status(r, 'guest').redundant).toBe(false);
    g.setParam('r1', 'up', false);
    r = await run(g);
    expect(status(r, 'web').state).toBe('online');
    expect(status(r, 'web').latency).toBeGreaterThan(20);
  });
});

describe('Editing network devices', () => {
  it('renames nodes, keeps the name in JSON, and undo restores it', () => {
    const reg = networkGraph.createRegistry();
    const g = Graph.fromJSON(networkGraph.examples![0].graph, reg);
    expect(g.nodes.get('nas')!.label).toBe('NAS');
    const changes: string[] = [];
    g.on('change', (c) => changes.push(c.kind));
    g.setLabel('nas', '  Backup box ');
    expect(g.nodes.get('nas')!.label).toBe('Backup box');
    expect(g.toJSON().nodes.find((n) => n.id === 'nas')!.label).toBe('Backup box');
    g.setLabel('nas', '');
    expect(g.nodes.get('nas')!.label).toBeUndefined();
    expect(changes).toEqual(['node:label', 'node:label']);
  });

  it('flags bad and duplicate IP addresses in results and validation', async () => {
    const reg = networkGraph.createRegistry();
    const g = Graph.fromJSON(networkGraph.examples![0].graph, reg);
    g.setParam('phone', 'ip', '192.168.1.10'); // same as the NAS
    g.setParam('lap', 'ip', '300.1.1.1');
    const r = await new Evaluator(g, reg).run();
    const st = (id: string) => r.results.get(id)!.outputs!.status as { ip?: string; ipIssue?: string };
    expect(st('desk')).toMatchObject({ ip: '192.168.1.20' });
    expect(st('desk').ipIssue).toBeUndefined();
    expect(st('phone').ipIssue).toMatch(/also used/);
    expect(st('nas').ipIssue).toMatch(/also used/);
    expect(st('lap').ipIssue).toMatch(/not an IPv4/);
    expect(g.validate().map((i) => i.node).sort()).toEqual(['lap', 'nas', 'phone']);
  });

  it('opens a full-size Edit sheet that changes name and params', () => {
    const reg = networkGraph.createRegistry();
    const g = Graph.fromJSON(networkGraph.examples![0].graph, reg);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    editor.openNodeEditor('router');
    const sheet = document.querySelector('.nm-edit')!;
    expect(sheet.querySelector('strong')!.textContent).toBe('Edit Home router');
    // Advanced params (IP, latency, bandwidth) are all there, not folded away.
    const labels = [...sheet.querySelectorAll('.nm-edit-field > span')].map((s) => s.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Name', 'powered', 'IP address', 'latency ms', 'Mbps']));
    const name = sheet.querySelector<HTMLInputElement>('#nm-edit-name')!;
    name.value = 'Gateway';
    name.dispatchEvent(new Event('input'));
    expect(g.nodes.get('router')!.label).toBe('Gateway');
    expect(el.querySelector('[data-id="router"] .nm-title')!.textContent).toBe('Gateway');
    const ip = sheet.querySelector<HTMLInputElement>('[data-key="p:ip"]')!;
    ip.value = '10.0.0.1';
    ip.dispatchEvent(new Event('input'));
    expect(g.nodes.get('router')!.params.ip).toBe('10.0.0.1');
    // The copy on the canvas follows.
    expect(el.querySelector<HTMLInputElement>('[data-id="router"] [data-key="p:ip"]')!.value).toBe('10.0.0.1');
    g.removeNode('router');
    expect(document.querySelector('.nm-edit')).toBeNull();
    editor.destroy();
  });
});

describe('Server specs', () => {
  it('servers have a type, cores, RAM, storage and OS, summarised on the node', async () => {
    const reg = networkGraph.createRegistry();
    const names = reg.get('net/server')!.params!.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['kind', 'cores', 'memory', 'storage', 'os', 'ip', 'up']));
    const g = Graph.fromJSON(networkGraph.examples![1].graph, reg);
    expect(deviceSpecs(g.nodes.get('db')!)).toBe('Database · 32 cores · 256 GB RAM · 4 TB · Linux');
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg, evaluator: new Evaluator(g, reg) });
    await new Promise((r) => setTimeout(r, 80));
    expect(el.querySelector('[data-id="db"] .nm-net-spec')!.textContent).toBe('Database · 32 cores · 256 GB RAM · 4 TB · Linux');
    editor.openNodeEditor('db');
    // Delete is in the pinned footer, outside the scrolling form.
    const sheet = document.querySelector('.nm-edit')!;
    const footer = sheet.querySelector(':scope > .nm-edit-actions')!;
    expect([...footer.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Duplicate', 'Delete']);
    expect(sheet.querySelector('.nm-form .nm-edit-actions')).toBeNull();
    editor.destroy();
  });
});
