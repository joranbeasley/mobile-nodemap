import { defineGraphType } from '../core/graph-type.js';
import type { Graph } from '../core/graph.js';
import type { GraphJSON } from '../core/types.js';
import { UML, umlEngine, umlPack } from '../packs/uml.js';

type Rel = 'extends' | 'implements' | 'has' | 'owns' | 'aggregates' | 'uses' | 'note';

const C = (id: string, label: string, params: Record<string, unknown> = {}) => ({ id, type: 'uml/class', label, x: 0, y: 0, params: { abstract: false, attributes: '', methods: '', ...params } });
const I = (id: string, label: string, methods = '') => ({ id, type: 'uml/interface', label, x: 0, y: 0, params: { methods } });
const E = (id: string, label: string, values: string[]) => ({ id, type: 'uml/enum', label, x: 0, y: 0, params: { values: values.join('\n') } });
const NOTE = (id: string, text: string) => ({ id, type: 'uml/note', x: 0, y: 0, params: { text } });

/** Build a class diagram from "a rel b" triples, picking the ports from the relationship. */
function diagram(nodes: GraphJSON['nodes'], rels: [string, Rel, string][]): GraphJSON {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  return {
    version: 1,
    type: 'uml',
    nodes,
    edges: rels.map(([a, rel, b]) => {
      const [from, to] =
        rel === 'extends'
          ? [type.get(a) === 'uml/interface' ? 'subinterfaces' : 'subclasses', 'extends']
          : rel === 'implements'
            ? ['implementations', 'implements']
            : [rel === 'note' ? 'about' : rel, 'referenced'];
      return { id: `${a}-${rel}-${b}`, from: { node: a, port: from }, to: { node: b, port: to } };
    }),
  };
}

const kind = (graph: Graph, id: string) => graph.nodes.get(id)?.type;

/** Is `target` above `start` in the inheritance tree (following extends / implements upwards)? */
function inherits(graph: Graph, start: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.incoming(id)) if (e.to.port === 'extends' || e.to.port === 'implements') stack.push(e.from.node);
  }
  return false;
}

/**
 * UML class diagrams: classes, interfaces, enums and notes, joined by inheritance,
 * realisation, association, composition, aggregation and dependency. An engine checks that
 * concrete classes implement what their interfaces and abstract parents require, and every
 * classifier can be exported as TypeScript.
 */
export const umlGraph = defineGraphType({
  id: 'uml',
  title: 'UML',
  description: 'Class diagrams. Wires go from parent to child and from owner to part; the engine checks that every class implements its interfaces, and each class shows its TypeScript when tapped.',
  icon: '▭',
  packs: [umlPack],
  engine: umlEngine,
  rules: {
    // Associations may point both ways; inheritance cycles are vetoed below.
    allowCycles: true,
    canConnect: (from, to, graph) => {
      const pt = to.def.type;
      if (pt === UML.generalization) {
        if (kind(graph, from.node) !== kind(graph, to.node)) return 'Classes extend classes and interfaces extend interfaces';
        if (from.node === to.node || inherits(graph, from.node, to.node)) return 'That would make a class its own ancestor';
      }
      if (pt === UML.realization && inherits(graph, from.node, to.node)) return 'That would make a class its own ancestor';
    },
    validate: (graph) => {
      const issues: { level: 'warning'; message: string; node?: string }[] = [];
      const names = new Map<string, string>();
      for (const n of graph.nodes.values()) {
        if (n.type === 'uml/note') continue;
        const name = (n.label ?? '').trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) issues.push({ level: 'warning', message: `“${name}” is not a valid type name`, node: n.id });
        else if (names.has(name)) issues.push({ level: 'warning', message: `Two classifiers are called ${name}`, node: n.id });
        names.set(name, n.id);
      }
      return issues;
    },
  },
  editor: { wires: 'smart', autoLayout: true, direction: 'TB' },
  examples: [
    {
      id: 'shapes',
      name: 'Shapes',
      description: 'Tap a class to see its TypeScript. Double-tap (or the pencil) to edit its name, attributes and methods.',
      graph: diagram(
        [
          I('shape', 'Shape', 'area(): number\nperimeter(): number'),
          C('polygon', 'Polygon', { abstract: true, attributes: '# sides: number', methods: '{abstract} area(): number\n+ perimeter(): number' }),
          C('rect', 'Rectangle', { attributes: '- width: number\n- height: number', methods: '+ area(): number' }),
          C('square', 'Square', { methods: 'static of(size: number): Square' }),
          C('circle', 'Circle', { attributes: '- radius: number', methods: '+ area(): number\n+ perimeter(): number' }),
          C('canvas', 'Canvas', { attributes: '- shapes: Shape[]\n- background: Color', methods: '+ add(shape: Shape): void\n+ render(): void' }),
          E('color', 'Color', ['Red', 'Green', 'Blue']),
          NOTE('n1', 'A square is a rectangle\nwith equal sides'),
        ],
        [
          ['shape', 'implements', 'polygon'],
          ['shape', 'implements', 'circle'],
          ['polygon', 'extends', 'rect'],
          ['rect', 'extends', 'square'],
          ['canvas', 'owns', 'shape'],
          ['canvas', 'uses', 'color'],
          ['n1', 'note', 'square'],
        ],
      ),
    },
    {
      id: 'shop',
      name: 'Shop',
      description: 'PayPalPayment forgets refund(), so the engine flags it. Add “+ refund(order: Order): void” to its methods to fix it.',
      graph: diagram(
        [
          C('customer', 'Customer', { attributes: '+ name: string\n+ email: string', methods: '+ checkout(): Order' }),
          C('order', 'Order', { attributes: '+ id: string\n+ status: OrderStatus', methods: '+ total(): number' }),
          C('line', 'OrderLine', { attributes: '+ quantity: number', methods: '+ subtotal(): number' }),
          C('product', 'Product', { attributes: '+ sku: string\n+ price: number' }),
          E('status', 'OrderStatus', ['Pending', 'Paid', 'Shipped', 'Cancelled']),
          I('pay', 'PaymentService', 'charge(order: Order): boolean\nrefund(order: Order): void'),
          C('stripe', 'StripePayment', { attributes: '- apiKey: string', methods: '+ charge(order: Order): boolean\n+ refund(order: Order): void' }),
          C('paypal', 'PayPalPayment', { methods: '+ charge(order: Order): boolean' }),
        ],
        [
          ['customer', 'has', 'order'],
          ['order', 'owns', 'line'],
          ['line', 'has', 'product'],
          ['order', 'uses', 'status'],
          ['order', 'uses', 'pay'],
          ['pay', 'implements', 'stripe'],
          ['pay', 'implements', 'paypal'],
        ],
      ),
    },
  ],
});
