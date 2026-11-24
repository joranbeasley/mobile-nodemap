// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Registry } from '../src/core';
import { Evaluator, stdlib } from '../src/runtime';
import { NodeEditor } from '../src/editor';

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
    const item = [...el.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')].find((b) => b.textContent!.startsWith('Add'))!;
    item.click();
    expect(g.nodes.size).toBe(1);
    expect([...g.nodes.values()][0].type).toBe('math/add');
    expect(el.querySelector('.nm-sheet')).toBeNull();
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
    [...el.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')].find((b) => b.textContent!.startsWith(title))!.click();
  };

  it('adds downstream of a node whose output is unused', async () => {
    const { g, el, editor } = setup();
    const n = g.addNode('value/number', { id: 'n' });
    editor.select({ node: n.id });
    editor.openAddSheet();
    expect(el.querySelector('.nm-sheet-head strong')!.textContent).toBe('Add after Number');
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
    expect(el.querySelector('.nm-sheet-head strong')!.textContent).toBe('Add before Display');
    const seg = el.querySelectorAll<HTMLButtonElement>('.nm-seg button');
    expect(seg[1].disabled).toBe(true); // Display has no outputs
    await pick(el, 'Text');
    const e = [...g.edges.values()][0];
    expect(e.to).toEqual({ node: 'd', port: 'value' });

    g.addNode('math/add', { id: 's' });
    editor.select({ node: 's' });
    editor.openAddSheet();
    el.querySelectorAll<HTMLButtonElement>('.nm-seg button')[0].click(); // before
    [...el.querySelectorAll<HTMLButtonElement>('.nm-chips button')].find((b) => b.textContent === 'b')!.click();
    expect(el.querySelector('.nm-sheet-head small')!.textContent).toContain('“b”');
    await pick(el, 'Number');
    expect(g.incoming('s').map((x) => x.to.port)).toEqual(['b']);
    editor.destroy();
  });

  it('can add an unconnected node instead', async () => {
    const { g, el, editor } = setup();
    g.addNode('value/number', { id: 'n' });
    editor.select({ node: 'n' });
    editor.openAddSheet();
    el.querySelectorAll<HTMLButtonElement>('.nm-seg button')[2].click();
    await pick(el, 'Text');
    expect(g.edges.size).toBe(0);
    expect(g.nodes.size).toBe(2);
    editor.destroy();
  });
});
