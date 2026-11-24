import { describe, it, expect } from 'vitest';
import { Graph, Registry, History, ConnectionError, defineNode } from '../src/core';

const reg = new Registry([
  defineNode({ type: 'num', params: [{ name: 'value', kind: 'number', default: 2 }], outputs: [{ name: 'value', type: 'number' }] }),
  defineNode({ type: 'txt', outputs: [{ name: 'value', type: 'string' }] }),
  defineNode({ type: 'add', inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }], outputs: [{ name: 'out', type: 'number' }] }),
]);

describe('Graph', () => {
  it('adds nodes with param defaults', () => {
    const g = new Graph(reg);
    const n = g.addNode('num', { x: 5 });
    expect(n.params.value).toBe(2);
    expect(n.x).toBe(5);
    expect(() => g.addNode('nope')).toThrow(/Unknown/);
  });

  it('validates connections: ports, types, loops', () => {
    const g = new Graph(reg);
    const a = g.addNode('num');
    const t = g.addNode('txt');
    const s1 = g.addNode('add');
    const s2 = g.addNode('add');
    expect(g.canConnect({ node: t.id, port: 'value' }, { node: s1.id, port: 'a' })).toMatch(/Type mismatch/);
    expect(g.canConnect({ node: a.id, port: 'zzz' }, { node: s1.id, port: 'a' })).toMatch(/No output/);
    g.connect({ node: a.id, port: 'value' }, { node: s1.id, port: 'a' });
    g.connect({ node: s1.id, port: 'out' }, { node: s2.id, port: 'a' });
    expect(() => g.connect({ node: s2.id, port: 'out' }, { node: s1.id, port: 'b' })).toThrow(ConnectionError);
  });

  it('replaces the existing edge on an input', () => {
    const g = new Graph(reg);
    const a = g.addNode('num');
    const b = g.addNode('num');
    const s = g.addNode('add');
    g.connect({ node: a.id, port: 'value' }, { node: s.id, port: 'a' });
    g.connect({ node: b.id, port: 'value' }, { node: s.id, port: 'a' });
    expect(g.incoming(s.id)).toHaveLength(1);
    expect(g.incoming(s.id)[0].from.node).toBe(b.id);
  });

  it('topologically sorts and removes edges with nodes', () => {
    const g = new Graph(reg);
    const s = g.addNode('add', { id: 's' });
    const a = g.addNode('num', { id: 'a' });
    g.connect({ node: 'a', port: 'value' }, { node: 's', port: 'a' });
    expect(g.topoSort().map((n) => n.id)).toEqual(['a', 's']);
    g.removeNode(a.id);
    expect(g.edges.size).toBe(0);
    expect(g.nodes.has(s.id)).toBe(true);
  });

  it('round-trips through JSON', () => {
    const g = new Graph(reg);
    g.addNode('num', { id: 'a' });
    g.addNode('add', { id: 's' });
    g.connect({ node: 'a', port: 'value' }, { node: 's', port: 'b' }, 'e1');
    const copy = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())), reg);
    expect(copy.toJSON()).toEqual(g.toJSON());
  });
});

describe('History', () => {
  it('undoes and redoes', () => {
    const g = new Graph(reg);
    const h = new History(g);
    g.addNode('num', { id: 'a' });
    h.commit();
    g.setParam('a', 'value', 9);
    h.undo();
    expect(g.nodes.get('a')!.params.value).toBe(2);
    h.undo();
    expect(g.nodes.size).toBe(0);
    h.redo();
    h.redo();
    expect(g.nodes.get('a')!.params.value).toBe(9);
    h.dispose();
  });
});
