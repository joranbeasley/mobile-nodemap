// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Graph, Evaluator, NodeEditor, umlGraph, umlToTypeScript, parseUmlMembers, getGraphType, type UmlStatus } from '../src/index';

const load = (id: string) => Graph.fromJSON(umlGraph.examples!.find((e) => e.id === id)!.graph, umlGraph.createRegistry());
const run = (g: Graph) => new Evaluator(g, g.registry!).run();
const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.results.get(id)!.outputs!.uml as UmlStatus;

describe('UML graph type', () => {
  it('is registered and flows top to bottom', () => {
    expect(getGraphType('uml')).toBe(umlGraph);
    expect(umlGraph.editor?.direction).toBe('TB');
  });

  it('parses members with visibility, types and modifiers', () => {
    const [field, method, abs, stat] = parseUmlMembers('- count: number\n# draw(ctx: Ctx): void\n{abstract} area(): number\nstatic of(n: number): Sq');
    expect(field).toMatchObject({ visibility: '-', name: 'count', type: 'number', isMethod: false });
    expect(method).toMatchObject({ visibility: '#', name: 'draw', params: 'ctx: Ctx', type: 'void', isMethod: true });
    expect(abs).toMatchObject({ name: 'area', isAbstract: true, visibility: '+' });
    expect(stat).toMatchObject({ name: 'of', isStatic: true });
  });

  it('checks that concrete classes implement their interfaces', async () => {
    const g = load('shop');
    const r = await run(g);
    expect(status(r, 'paypal').warnings[0]).toMatch(/Missing from PaymentService: refund\(\)/);
    expect(r.results.get('paypal')!.status).toBe('error');
    expect(status(r, 'stripe').warnings).toEqual([]);
    expect(r.outputs).toMatchObject({ classes: 6, interfaces: 1, enums: 1, warnings: 1 });

    g.setParam('paypal', 'methods', '+ charge(order: Order): boolean\n+ refund(order: Order): void');
    expect((await run(g)).outputs.warnings).toBe(0);
  });

  it('counts inherited methods and checks abstract ones', async () => {
    const g = load('shapes');
    const r = await run(g);
    // Square gets area() from Rectangle and perimeter() from Polygon.
    expect(status(r, 'square').warnings).toEqual([]);
    expect(status(r, 'polygon').warnings).toEqual([]); // abstract: may leave area() open
    expect(status(r, 'square').parents).toEqual(['Rectangle']);

    g.setParam('rect', 'methods', '');
    const again = await run(g);
    expect(status(again, 'rect').warnings.join()).toMatch(/area\(\)/);
  });

  it('allows single inheritance only and no inheritance cycles', () => {
    const g = load('shapes');
    expect(g.canConnect({ node: 'square', port: 'subclasses' }, { node: 'polygon', port: 'extends' })).toMatch(/own ancestor/);
    expect(g.canConnect({ node: 'canvas', port: 'subclasses' }, { node: 'shape', port: 'extends' })).toMatch(/interfaces extend interfaces/);
    // A second superclass replaces the first: `extends` takes one wire.
    g.connect({ node: 'canvas', port: 'subclasses' }, { node: 'square', port: 'extends' });
    expect([...g.edges.values()].filter((e) => e.to.node === 'square' && e.to.port === 'extends')).toHaveLength(1);
    // Associations may loop.
    expect(g.canConnect({ node: 'square', port: 'has' }, { node: 'canvas', port: 'referenced' })).toBeNull();
  });

  it('exports TypeScript with parents first', () => {
    const g = load('shapes');
    const ts = umlToTypeScript(g, g.registry!);
    expect(ts).toContain('export interface Shape {\n  area(): number;');
    expect(ts).toContain('export abstract class Polygon implements Shape {');
    expect(ts).toContain('  abstract area(): number;');
    expect(ts).toContain('export class Square extends Rectangle {');
    expect(ts).toContain('export enum Color {\n  Red,');
    expect(ts.indexOf('class Polygon')).toBeLessThan(ts.indexOf('class Rectangle'));
    expect(ts.indexOf('class Rectangle')).toBeLessThan(ts.indexOf('class Square'));
    // Details card shows one classifier.
    const details = g.registry!.get('uml/class')!.details!(g.nodes.get('circle')!, { graph: g });
    expect(details.code!.text).toMatch(/^export class Circle implements Shape/);
  });

  it('draws relationships with UML markers', async () => {
    const g = load('shapes');
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, evaluator: new Evaluator(g, g.registry!) });
    const path = (id: string) => el.querySelector(`.nm-edge-g[data-edge="${id}"] .nm-edge`) as SVGPathElement;
    const impl = path('shape-implements-circle');
    expect(impl.getAttribute('marker-start')).toMatch(/triangle/);
    expect(impl.style.strokeDasharray).toBeTruthy();
    expect(path('polygon-extends-rect').style.strokeDasharray).toBeFalsy();
    expect(path('canvas-owns-shape').getAttribute('marker-start')).toMatch(/diamond-filled/);
    expect(path('canvas-uses-color').getAttribute('marker-end')).toMatch(/arrow/);
    expect(el.querySelectorAll('marker').length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(el.querySelector('[data-id="polygon"] .uml-stereo')!.textContent).toBe('«abstract»');
    editor.destroy();
  });
});
