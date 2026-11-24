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

  it('opens the add-node sheet and adds a node', () => {
    const reg = new Registry(stdlib);
    const g = new Graph(reg);
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: reg });
    editor.openPalette({ x: 0, y: 0 });
    const item = [...el.querySelectorAll<HTMLButtonElement>('.nm-sheet-item')].find((b) => b.textContent!.startsWith('Add'))!;
    item.click();
    expect(g.nodes.size).toBe(1);
    expect([...g.nodes.values()][0].type).toBe('math/add');
    expect(el.querySelector('.nm-sheet')).toBeNull();
    editor.destroy();
  });
});
