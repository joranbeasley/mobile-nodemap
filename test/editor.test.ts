// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Registry } from '../src/core';
import { Evaluator, stdlib } from '../src/runtime';
import { NodeEditor } from '../src/editor';
import { overlaps } from '../src/layout';

describe('NodeEditor', () => {
  it('renders nodes, ports and wires and reacts to graph edits', async () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'n' });
    g.addNode('view/display', { id: 'd', x: 260 });
    g.connect({ node: 'n', port: 'value' }, { node: 'd', port: 'value' });
    const el = document.createElement('div');
    document.body.append(el);
    const ev = new Evaluator(g, reg);
    const editor = new NodeEditor(el, { graph: g, registry: reg, evaluator: ev });
    expect(el.querySelectorAll('.nm-node')).toHaveLength(2);
    expect(el.querySelectorAll('.nm-edge-g')).toHaveLength(1);
    expect(el.querySelector('.nm-port[data-dir="in"]')!.classList.contains('nm-linked')).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    expect(el.querySelector('[data-id="d"] .nm-view')!.textContent).toBe('1');

    g.removeNode('n');
    expect(el.querySelectorAll('.nm-node')).toHaveLength(1);
    expect(el.querySelectorAll('.nm-edge-g')).toHaveLength(0);

    editor.history!.commit();
    editor.history!.undo();
    expect(el.querySelectorAll('.nm-node')).toHaveLength(2);
    editor.destroy();
  });

  it('opens the add-node sheet and adds a node', async () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    editor.openPalette({ x: 0, y: 0 });
    // Taps are ignored briefly after opening so a lifting finger cannot pick an item.
    await new Promise((r) => setTimeout(r, 380));
    const item = [...document.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')].find((b) => b.textContent!.startsWith('Add'))!;
    item.click();
    expect(g.nodes.size).toBe(1);
    expect([...g.nodes.values()][0].type).toBe('math/add');
    expect(document.querySelector('.nm-sheet')).toBeNull();
    editor.destroy();
  });
});

describe('Add with a node selected', () => {
  const setup = () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    return { reg, g, el, editor };
  };
  const pick = async (el: HTMLElement, title: string) => {
    await new Promise((r) => setTimeout(r, 380));
    [...document.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')].find((b) => b.textContent!.startsWith(title))!.click();
  };

  it('adds downstream of a node whose output is unused', async () => {
    const { g, el, editor } = setup();
    const n = g.addNode('value/number', { id: 'n' });
    editor.select({ node: n.id });
    editor.openAddSheet();
    expect(document.querySelector('.nm-sheet-head strong')!.textContent).toBe('Add after Number');
    await pick(el, 'Multiply');
    const e = [...g.edges.values()][0];
    expect(e.from).toEqual({ node: 'n', port: 'value' });
    expect(g.nodes.get(e.to.node)!.type).toBe('math/multiply');
    // The new node is selected, so the next + keeps extending the chain.
    expect(editor.selection.node).toBe(e.to.node);
    editor.destroy();
  });

  it('adds upstream of a node with no outputs, and lets you switch side and port', async () => {
    const { g, el, editor } = setup();
    g.addNode('view/display', { id: 'd' });
    editor.select({ node: 'd' });
    editor.openAddSheet();
    expect(document.querySelector('.nm-sheet-head strong')!.textContent).toBe('Add before Display');
    const seg = document.querySelectorAll<HTMLButtonElement>('.nm-seg button');
    expect(seg[1].disabled).toBe(true); // Display has no outputs
    await pick(el, 'Text');
    const e = [...g.edges.values()][0];
    expect(e.to).toEqual({ node: 'd', port: 'value' });

    g.addNode('math/add', { id: 's' });
    editor.select({ node: 's' });
    editor.openAddSheet();
    document.querySelectorAll<HTMLButtonElement>('.nm-seg button')[0].click(); // before
    [...document.querySelectorAll<HTMLButtonElement>('.nm-chips button')].find((b) => b.textContent === 'b')!.click();
    expect(document.querySelector('.nm-sheet-head small')!.textContent).toContain('“b”');
    await pick(el, 'Number');
    expect(g.incoming('s').map((x) => x.to.port)).toEqual(['b']);
    editor.destroy();
  });

  it('can add an unconnected node instead', async () => {
    const { g, el, editor } = setup();
    g.addNode('value/number', { id: 'n' });
    editor.select({ node: 'n' });
    editor.openAddSheet();
    document.querySelectorAll<HTMLButtonElement>('.nm-seg button')[2].click();
    await pick(el, 'Text');
    expect(g.edges.size).toBe(0);
    expect(g.nodes.size).toBe(2);
    editor.destroy();
  });
});

describe('Making room for new nodes', () => {
  const setup = () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    return { g, el, editor };
  };
  const pick = async (el: HTMLElement, title: string) => {
    await new Promise((r) => setTimeout(r, 380));
    [...document.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')].find((b) => b.textContent!.startsWith(title))!.click();
    await new Promise((r) => setTimeout(r, 400)); // let neighbours finish animating
  };
  const box = (g: Graph, id: string) => ({ x: g.nodes.get(id)!.x, y: g.nodes.get(id)!.y, w: 180, h: 80 });
  const noOverlap = (g: Graph) => {
    const ids = [...g.nodes.keys()];
    ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => expect(overlaps(box(g, a), box(g, b))).toBe(false)));
  };

  it('a tapped output port plus + adds a node on that output', async () => {
    const { g, el, editor } = setup();
    g.addNode('math/add', { id: 'a' });
    const port = el.querySelector<HTMLElement>('.nm-port[data-node="a"][data-dir="out"]')!;
    (editor as any).tapPort({ node: 'a', port: port.dataset.port, dir: 'out' });
    editor.openAddSheet();
    expect(document.querySelector('.nm-sheet-head strong')!.textContent).toBe('Add after Add');
    await pick(el, 'Display');
    expect([...g.edges.values()].map((e) => e.from)).toEqual([{ node: 'a', port: 'out' }]);
    editor.destroy();
  });

  it('stacks a new sibling under the existing one and pushes the column down', async () => {
    const { g, el, editor } = setup();
    g.addNode('value/number', { id: 'src', x: 0, y: 0 });
    g.addNode('view/display', { id: 'b', x: 250, y: 0 });
    g.addNode('view/display', { id: 'c', x: 250, y: 110 }); // unrelated node right below b
    g.connect({ node: 'src', port: 'value' }, { node: 'b', port: 'value' });
    editor.select({ node: 'src' });
    editor.openAddSheet();
    document.querySelectorAll<HTMLButtonElement>('.nm-seg button')[1].click(); // after
    await pick(el, 'Display');
    const added = [...g.nodes.keys()].find((k) => !['src', 'b', 'c'].includes(k))!;
    expect(g.nodes.get(added)!.x).toBe(250);
    expect(g.nodes.get(added)!.y).toBeGreaterThan(g.nodes.get('b')!.y);
    noOverlap(g);
    editor.destroy();
  });

  it('inserts into a selected wire and shifts downstream nodes right', async () => {
    const { g, el, editor } = setup();
    g.addNode('value/number', { id: 'a', x: 0, y: 0 });
    g.addNode('math/multiply', { id: 'm', x: 250, y: 0 });
    g.addNode('view/display', { id: 'd', x: 500, y: 0 });
    const e = g.connect({ node: 'a', port: 'value' }, { node: 'm', port: 'a' });
    g.connect({ node: 'm', port: 'out' }, { node: 'd', port: 'value' });
    editor.select({ edge: e.id });
    editor.openAddSheet();
    expect(document.querySelector('.nm-sheet-head strong')!.textContent).toBe('Insert into wire');
    await pick(el, 'Power');
    const p = [...g.nodes.values()].find((n) => n.type === 'math/power')!;
    expect(g.incoming(p.id)[0].from.node).toBe('a');
    expect(g.incoming('m').find((x) => x.to.port === 'a')!.from.node).toBe(p.id);
    expect(g.nodes.get('m')!.x).toBeGreaterThan(p.x + 180);
    expect(g.nodes.get('d')!.x).toBeGreaterThan(g.nodes.get('m')!.x);
    noOverlap(g);
    editor.destroy();
  });
});

describe('Overview zoom', () => {
  const setup = () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'n', x: 400, y: 300, params: { value: 1 } });
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    return { g, el, editor };
  };
  const tap = (target: Element) => {
    const o = { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10, button: 0 };
    target.dispatchEvent(new PointerEvent('pointerdown', o));
    target.dispatchEvent(new PointerEvent('pointerup', o));
  };

  it('marks the overview and turns a tap on a node’s field into “zoom in on the node”', async () => {
    const { g, el, editor } = setup();
    editor.setViewport({ k: 0.3, x: 0, y: 0 });
    expect(editor.isOverview).toBe(true);
    expect(el.classList.contains('nm-overview')).toBe(true);
    // Tap straight on the node's number field.
    tap(el.querySelector('[data-id="n"] input[type="number"]')!);
    expect(editor.selection.node).toBe('n');
    await new Promise((r) => setTimeout(r, 450));
    expect(editor.viewport.k).toBeGreaterThanOrEqual(0.6);
    expect(editor.isOverview).toBe(false);
    expect(el.classList.contains('nm-overview')).toBe(false);
    expect(g.nodes.get('n')!.params.value).toBe(1);   // nothing was edited
    expect(document.querySelector('.nm-edit')).toBeNull(); // and no edit sheet
    editor.destroy();
  });

  it('at a readable zoom, taps on a selected node’s fields are left to the field', () => {
    const { el, editor } = setup();
    editor.setViewport({ k: 1 });
    expect(editor.isOverview).toBe(false);
    editor.select({ node: 'n' });
    const changes: unknown[] = [];
    editor.on('select', (s) => changes.push(s));
    tap(el.querySelector('[data-id="n"] input[type="number"]')!);
    expect(changes).toEqual([]); // the editor didn't handle it; the field did
    expect(editor.viewport.k).toBe(1);
    editor.destroy();
  });

  it('zoomToNode centres a node at a comfortable zoom', () => {
    const { editor } = setup();
    editor.setViewport({ k: 0.25 });
    editor.zoomToNode('n', { animate: false });
    expect(editor.viewport.k).toBe(1);
  });
});

describe('Flow direction in the editor', () => {
  it('top to bottom: tidies into a column and places new nodes below', async () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'a', x: 0, y: 0 });
    g.addNode('math/multiply', { id: 'm', x: 10, y: 10 });
    g.connect({ node: 'a', port: 'value' }, { node: 'm', port: 'a' });
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg, direction: 'TB' });
    expect(editor.flow).toBe('TB');
    expect(el.dataset.flow).toBe('TB');
    await editor.autoLayout({ animate: false });
    expect(g.meta.flow).toBe('TB');
    expect(g.nodes.get('m')!.y).toBeGreaterThan(g.nodes.get('a')!.y + 80);
    const added = editor.addNode('view/display', undefined, { node: 'm', port: 'out', dir: 'out' });
    expect(g.nodes.get(added.id)!.y).toBeGreaterThan(g.nodes.get('m')!.y);
    editor.setDirection('LR');
    expect(editor.flow).toBe('LR');
    expect(el.dataset.flow).toBe('LR');
    editor.destroy();
  });
});

describe('Focus before fields, and ghosts for off-screen neighbours', () => {
  const tap = (target: Element) => {
    const o = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 10, button: 0 };
    target.dispatchEvent(new PointerEvent('pointerdown', o));
    target.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const setup = () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'a', x: 40, y: 40, params: { value: 2 } });
    g.addNode('view/display', { id: 'far', x: 3000, y: 60 });
    g.connect({ node: 'a', port: 'value' }, { node: 'far', port: 'value' });
    const el = document.createElement('div');
    document.body.append(el);
    // happy-dom has no layout: give the canvas a phone-sized box.
    el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700, toJSON: () => ({}) }) as DOMRect;
    const editor = new NodeEditor(el, { graph: g, registry: reg, direction: 'LR' });
    editor.setViewport({ x: 0, y: 0, k: 1 });
    return { g, el, editor };
  };

  it('a tap on an unselected node’s field selects the node instead', () => {
    const { el, editor } = setup();
    const field = el.querySelector('[data-id="a"] input[type="number"]')!;
    tap(field);
    expect(editor.selection.node).toBe('a');
    // Now that it is selected, the field gets the tap (the editor leaves it alone).
    editor.select({});
    editor.select({ node: 'a' });
    tap(field);
    expect(editor.selection.node).toBe('a');
    editor.destroy();
  });

  it('shows a ghost for an off-screen neighbour and pans to it', async () => {
    const { el, editor } = setup();
    editor.select({ node: 'a' });
    editor.renderGhosts();
    const ghost = el.querySelector<HTMLButtonElement>('.nm-ghost')!;
    expect(ghost).not.toBeNull();
    expect(ghost.dataset.node).toBe('far');
    expect(ghost.dataset.side).toBe('right');
    expect(ghost.textContent).toContain('Display');
    ghost.click();
    expect(editor.selection.node).toBe('far');
    await new Promise((r) => setTimeout(r, 400));
    // The far node is now in view, at the same zoom.
    const v = editor.viewport;
    expect(v.k).toBeCloseTo(1);
    expect(-v.x).toBeGreaterThan(2500);
    editor.renderGhosts();
    expect(el.querySelector('.nm-ghost')!.getAttribute('data-node')).toBe('a'); // and a ghost points back
    editor.destroy();
  });

  it('no ghosts when everything connected is on screen, or in the overview', () => {
    const { g, el, editor } = setup();
    g.moveNode('far', 250, 60);
    editor.renderGhosts();
    expect(el.querySelector('.nm-ghost')).toBeNull();
    g.moveNode('far', 3000, 60);
    editor.setViewport({ k: 0.3 });
    editor.renderGhosts();
    expect(el.querySelector('.nm-ghost')).toBeNull();
    editor.destroy();
  });
});
