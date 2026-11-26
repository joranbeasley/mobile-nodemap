// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Registry, Evaluator, NodeEditor, stdlib, defineNode, definePack, type EdgeStyler } from '../src/index';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
function mount(opts: { edgeStyle?: EdgeStyler; readOnly?: boolean; wires?: 'smart' | 'curved' } = {}) {
  const reg = new Registry(stdlib);
  const g = new Graph(reg);
  g.addNode('value/number', { id: 'n', x: 0, y: 0 });
  g.addNode('view/display', { id: 'd', x: 300, y: 0 });
  const edge = g.connect({ node: 'n', port: 'value' }, { node: 'd', port: 'value' });
  const el = document.createElement('div');
  document.body.append(el);
  const editor = new NodeEditor(el, { graph: g, registry: reg, evaluator: new Evaluator(g, reg), wires: opts.wires ?? 'curved', edgeStyle: opts.edgeStyle, readOnly: opts.readOnly });
  return { g, reg, el, editor, edge };
}

describe('Wire geometry', () => {
  it('gives a wire’s path and points along it in map coordinates', () => {
    const { editor, edge } = mount();
    const d = editor.edgePath(edge.id)!;
    expect(d).toMatch(/^M/);
    const a = editor.edgePointAt(edge.id, 0)!;
    const b = editor.edgePointAt(edge.id, 1)!;
    const mid = editor.edgePointAt(edge.id, 0.5)!;
    expect(b.x).toBeGreaterThan(a.x);
    expect(mid.x).toBeGreaterThan(a.x);
    expect(mid.x).toBeLessThan(b.x);
    expect(editor.edgePointAt('nope', 0.5)).toBeUndefined();
    editor.destroy();
  });

  it('announces re-routed wires', async () => {
    const { g, editor, edge } = mount();
    const seen: string[][] = [];
    editor.on('route', ({ edges }) => seen.push(edges));
    g.moveNode('d', 320, 40);
    expect(seen.flat()).toContain(edge.id);
    editor.destroy();
  });
});

describe('Layers', () => {
  it('adds HTML or SVG layers below or above the map that move with it', () => {
    const { el, editor } = mount();
    const below = editor.addLayer({ position: 'below', className: 'zones' });
    const above = editor.addLayer({ svg: true });
    const viewport = el.querySelector('.nm-viewport')!;
    expect(viewport.firstElementChild).toBe(below);
    expect(below.classList.contains('zones')).toBe(true);
    expect(above.tagName.toLowerCase()).toBe('svg');
    expect(above.parentElement).toBe(viewport);
    above.remove();
    editor.destroy();
  });
});

describe('Per-wire styles', () => {
  it('applies arrows, dash, colour, class and a label, and refreshes on demand', () => {
    let dir: 'forward' | 'both' | 'none' = 'forward';
    const style: EdgeStyler = () =>
      dir === 'none' ? { start: 'none', end: 'none' } : { end: 'arrow', start: dir === 'both' ? 'arrow' : undefined, dash: true, color: '#e03131', className: 'hot link', label: '120 req/s' };
    const { el, editor, edge } = mount({ edgeStyle: style });
    const g = () => el.querySelector<SVGGElement>(`.nm-edge-g[data-edge="${edge.id}"]`)!;
    const line = () => g().querySelector<SVGPathElement>('.nm-edge')!;
    expect(line().getAttribute('marker-end')).toMatch(/arrow/);
    expect(line().getAttribute('marker-start')).toBeNull();
    expect(line().style.strokeDasharray).toBe('7 5');
    expect(line().style.getPropertyValue('--nm-port-color')).toBe('#e03131');
    expect(g().classList.contains('hot')).toBe(true);
    const label = el.querySelector<HTMLElement>(`.nm-edge-label[data-edge="${edge.id}"]`)!;
    expect(label.textContent).toBe('120 req/s');
    expect(label.style.transform).toMatch(/translate\(/);
    dir = 'both';
    editor.refreshEdges();
    expect(line().getAttribute('marker-start')).toMatch(/arrow/);
    dir = 'none';
    editor.refreshEdges([edge.id]);
    expect(line().getAttribute('marker-end')).toBeNull();
    expect(g().classList.contains('hot')).toBe(false);
    expect(el.querySelector('.nm-edge-label')).toBeNull();
    editor.destroy();
  });
});

describe('Pulses', () => {
  it('runs a dot along a wire and resolves when it arrives', async () => {
    const { el, editor, edge } = mount();
    const done = editor.pulse(edge.id, { ms: 40, color: '#2f9e44', reverse: true });
    await tick(5);
    const dot = el.querySelector<SVGCircleElement>('.nm-pulses .nm-pulse');
    expect(dot).toBeTruthy();
    await done;
    expect(el.querySelector('.nm-pulse')).toBeNull();
    await editor.pulse('missing'); // no wire: resolves straight away
    editor.destroy();
  });
});

describe('Edit sheet stays in step', () => {
  it('refreshes custom param controls in the sheet when the value changes elsewhere', () => {
    const shown: unknown[] = [];
    const reg = new Registry().use(
      definePack({
        id: 't',
        paramKinds: [
          {
            kind: 'tags',
            render: (ctx) => Object.assign(document.createElement('div'), { textContent: String(ctx.value) }),
            update: (el, v) => {
              shown.push(v);
              el.textContent = String(v);
            },
          },
        ],
        nodes: [defineNode({ type: 't/x', params: [{ name: 'tags', kind: 'tags', default: 'a' }] })],
      }),
    );
    const g = new Graph(reg);
    g.addNode('t/x', { id: 'x' });
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    editor.openNodeEditor('x');
    g.setParam('x', 'tags', 'b, c');
    expect(document.querySelector('.nm-edit [data-param="tags"]')!.textContent).toBe('b, c');
    editor.closePalette();
    editor.destroy();
  });
});

describe('Read-only mode', () => {
  it('blocks editing but keeps viewing', async () => {
    const { g, el, editor } = mount({ readOnly: true });
    expect(el.hasAttribute('data-readonly')).toBe(true);
    expect(editor.readOnly).toBe(true);
    editor.select({ node: 'n' });
    editor.deleteSelection();
    expect(g.nodes.has('n')).toBe(true);
    editor.openAddSheet();
    editor.openNodeEditor('n');
    expect(document.querySelector('.nm-sheet')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('.nm-node[data-id="n"] input')!.disabled).toBe(true);
    // Back to editing.
    editor.setReadOnly(false);
    expect(el.hasAttribute('data-readonly')).toBe(false);
    expect(el.querySelector<HTMLInputElement>('.nm-node[data-id="n"] input')!.disabled).toBe(false);
    editor.destroy();
  });
});
