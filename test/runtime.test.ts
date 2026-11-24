import { describe, it, expect } from 'vitest';
import { Graph, Registry } from '../src/core';
import { Evaluator, compile, graphNode, signature, stdlib } from '../src/runtime';

const registry = () => new Registry(stdlib);

function sumGraph(reg: Registry) {
  const g = new Graph(reg);
  g.addNode('graph/input', { id: 'x', params: { name: 'x', type: 'number', value: 1 } });
  g.addNode('graph/input', { id: 'y', y: 100, params: { name: 'y', type: 'number', value: 2 } });
  g.addNode('math/add', { id: 'add' });
  g.addNode('graph/output', { id: 'out', params: { name: 'sum' } });
  g.connect({ node: 'x', port: 'value' }, { node: 'add', port: 'a' });
  g.connect({ node: 'y', port: 'value' }, { node: 'add', port: 'b' });
  g.connect({ node: 'add', port: 'out' }, { node: 'out', port: 'value' });
  return g;
}

describe('Evaluator', () => {
  it('evaluates a graph with inline input values', async () => {
    const reg = registry();
    const g = new Graph(reg);
    g.addNode('value/number', { id: 'n', params: { value: 4 } });
    g.addNode('math/multiply', { id: 'm', params: { b: 3 } });
    g.connect({ node: 'n', port: 'value' }, { node: 'm', port: 'a' });
    const ev = new Evaluator(g, reg);
    const r = await ev.run();
    expect(r.results.get('m')!.outputs!.out).toBe(12);
  });

  it('only re-runs nodes whose inputs changed', async () => {
    const reg = registry();
    const g = sumGraph(reg);
    g.addNode('value/number', { id: 'lonely' });
    const ev = new Evaluator(g, reg);
    await ev.run();
    g.setParam('y', 'value', 10);
    const r = await ev.run();
    expect(r.outputs.sum).toBe(11);
    expect(r.executed.sort()).toEqual(['add', 'out', 'y']);
  });

  it('reports errors and skips downstream nodes', async () => {
    const reg = registry();
    const g = new Graph(reg);
    g.addNode('math/divide', { id: 'd', params: { a: 1, b: 0 } });
    g.addNode('view/display', { id: 'v' });
    g.connect({ node: 'd', port: 'out' }, { node: 'v', port: 'value' });
    const r = await new Evaluator(g, reg).run();
    expect(r.errors).toEqual([{ node: 'd', error: 'Division by zero' }]);
    expect(r.results.get('v')!.status).toBe('skipped');
  });

  it('runs independent async branches in parallel and aborts stale runs', async () => {
    const reg = registry();
    const g = new Graph(reg);
    g.addNode('async/delay', { id: 'a', params: { ms: 60 } });
    g.addNode('async/delay', { id: 'b', params: { ms: 60 } });
    const ev = new Evaluator(g, reg);
    const t0 = Date.now();
    const first = ev.run();
    const second = ev.run({ force: true });
    expect((await first).aborted).toBe(true);
    await second;
    expect(Date.now() - t0).toBeLessThan(110);
  });

  it('supports expression nodes with dynamic ports', async () => {
    const reg = registry();
    const g = new Graph(reg);
    g.addNode('math/expression', { id: 'e', params: { vars: 'r', expr: 'round(PI * r ** 2)', r: 2 } });
    expect(reg.inputsOf(g.nodes.get('e')!).map((p) => p.name)).toEqual(['r']);
    const r = await new Evaluator(g, reg).run();
    expect(r.results.get('e')!.outputs!.out).toBe(13);
  });

  it('maps lists', async () => {
    const reg = registry();
    const g = new Graph(reg);
    g.addNode('list/range', { id: 'r', params: { start: 0, end: 3, count: 4 } });
    g.addNode('list/map', { id: 'm', params: { expr: 'x * k', k: 2 } });
    g.addNode('list/reduce', { id: 's' });
    g.connect({ node: 'r', port: 'list' }, { node: 'm', port: 'list' });
    g.connect({ node: 'm', port: 'list' }, { node: 's', port: 'list' });
    const r = await new Evaluator(g, reg).run();
    expect(r.results.get('m')!.outputs!.list).toEqual([0, 2, 4, 6]);
    expect(r.results.get('s')!.outputs!.out).toBe(12);
  });
});

describe('compile / graphNode', () => {
  it('turns a graph into an async function', async () => {
    const reg = registry();
    const f = compile(sumGraph(reg), reg);
    expect(typeof f).toBe('function');
    expect(signature(sumGraph(reg)).inputs.map((i) => i.name)).toEqual(['x', 'y']);
    expect(await f({ x: 5, y: 6 })).toEqual({ sum: 11 });
    expect(await f()).toEqual({ sum: 3 });
  });

  it('nests a graph as a node type', async () => {
    const reg = registry();
    reg.define(graphNode({ type: 'fn/sum', graph: sumGraph(reg), registry: reg }));
    const g = new Graph(reg);
    g.addNode('fn/sum', { id: 's', params: { x: 20, y: 22 } });
    const r = await new Evaluator(g, reg).run();
    expect(r.results.get('s')!.outputs).toEqual({ sum: 42 });
  });
});
