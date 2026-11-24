import { defineNode, definePack, type GraphEngine } from '../core/registry.js';
import type { Graph } from '../core/graph.js';
import type { Registry } from '../core/registry.js';
import type { NodeInstance, NodeResult, NodeType, PortTypeDef } from '../core/types.js';

/**
 * UML class diagrams. Classifiers (class, interface, enum) are nodes; relationships are typed
 * wires, drawn the UML way: inheritance with a hollow triangle, realisation dashed,
 * association with an open arrow, composition with a filled diamond, dependency dashed.
 *
 * Wires run from the general to the specific (parent → child, owner → part, user → used), so
 * a tidy layout puts superclasses and owners first: on top, or on the left.
 */

// ------------------------------------------------------------------ relationship types

export const UML = {
  generalization: 'uml-generalization',
  realization: 'uml-realization',
  association: 'uml-association',
  composition: 'uml-composition',
  aggregation: 'uml-aggregation',
  dependency: 'uml-dependency',
  note: 'uml-note',
  /** The "referenced" input accepts every reference-like relationship. */
  ref: 'uml-ref',
} as const;

const portTypes: PortTypeDef[] = [
  { id: UML.generalization, label: 'Inheritance', color: '#495057', inline: false, wire: { start: 'triangle' } },
  { id: UML.realization, label: 'Implements', color: '#7048e8', inline: false, wire: { start: 'triangle', dash: true } },
  { id: UML.association, label: 'Association', color: '#1971c2', inline: false, wire: { end: 'arrow' } },
  { id: UML.composition, label: 'Composition', color: '#c2255c', inline: false, wire: { start: 'diamond-filled' } },
  { id: UML.aggregation, label: 'Aggregation', color: '#0c8599', inline: false, wire: { start: 'diamond' } },
  { id: UML.dependency, label: 'Dependency', color: '#868e96', inline: false, wire: { end: 'arrow', dash: true } },
  { id: UML.note, label: 'Note', color: '#e67700', inline: false, wire: { dash: '2 4' } },
  {
    id: UML.ref,
    label: 'Referenced',
    color: '#1971c2',
    inline: false,
    accepts: [UML.association, UML.composition, UML.aggregation, UML.dependency, UML.note],
  },
];

// ------------------------------------------------------------------ members

export interface UmlMember {
  visibility: '+' | '-' | '#' | '~';
  name: string;
  /** Methods: the text between the parentheses. */
  params?: string;
  type?: string;
  isMethod: boolean;
  isAbstract: boolean;
  isStatic: boolean;
}

/**
 * Parse UML member lines: `+ name: type`, `- count(): number`, `# draw(ctx: Ctx): void`,
 * `{abstract} area(): number`, `static create(): Shape`. Blank lines are skipped.
 */
export function parseMembers(text: unknown): UmlMember[] {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      let rest = line;
      let isAbstract = false;
      let isStatic = false;
      for (;;) {
        const m = /^(\{abstract\}|abstract\s+|\{static\}|static\s+)/i.exec(rest);
        if (!m) break;
        if (/abstract/i.test(m[1])) isAbstract = true;
        else isStatic = true;
        rest = rest.slice(m[0].length).trim();
      }
      const vis = /^[+\-#~]/.test(rest) ? (rest[0] as UmlMember['visibility']) : '+';
      rest = rest.replace(/^[+\-#~]\s*/, '');
      const method = /^([\w$]+)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/.exec(rest);
      if (method) return { visibility: vis, name: method[1], params: method[2].trim(), type: method[3]?.trim(), isMethod: true, isAbstract, isStatic };
      const field = /^([\w$]+)\s*(?::\s*(.+))?$/.exec(rest);
      return { visibility: vis, name: field?.[1] ?? rest, type: field?.[2]?.trim(), isMethod: false, isAbstract, isStatic };
    });
}

// ------------------------------------------------------------------ nodes

const kindOf = (n: Pick<NodeInstance, 'type'>) =>
  ({ 'uml/class': 'class', 'uml/interface': 'interface', 'uml/enum': 'enum', 'uml/note': 'note' } as Record<string, string>)[n.type] ?? 'other';

export const nameOf = (n: NodeInstance) => (n.label ?? '').trim() || ({ class: 'NewClass', interface: 'NewInterface', enum: 'NewEnum' } as Record<string, string>)[kindOf(n)] || 'Unnamed';

const icons = {
  class: 'C',
  interface: 'I',
  enum: 'E',
  note: '✎',
};

const membersParam = (name: string, label: string, def: string) => ({
  name,
  label,
  kind: 'text' as const,
  multiline: true,
  code: true,
  default: def,
  advanced: true,
  description: name === 'values' ? 'One value per line' : 'One per line, e.g. “+ name: string” or “- total(): number”',
});

const details = (node: NodeInstance, ctx: { graph: Graph }) => ({
  title: nameOf(node),
  subtitle: ({ class: node.params.abstract ? 'Abstract class' : 'Class', interface: 'Interface', enum: 'Enum' } as Record<string, string>)[kindOf(node)],
  code: { lang: 'ts', text: umlToTypeScript(ctx.graph, ctx.graph.registry!, [node.id]) },
});

const classNode = defineNode({
  type: 'uml/class',
  title: 'Class',
  category: 'Classifiers',
  color: '#1971c2',
  icon: icons.class,
  flavor: 'transform',
  width: 230,
  tags: ['uml', 'object', 'abstract'],
  description: 'Attributes and methods; may extend one class and implement interfaces',
  inputs: {
    extends: { type: UML.generalization, label: 'extends', description: 'The one class this extends' },
    implements: { type: UML.realization, multiple: true, label: 'implements' },
    referenced: { type: UML.ref, multiple: true, label: 'used by' },
  },
  outputs: {
    subclasses: { type: UML.generalization, label: 'subclasses' },
    has: { type: UML.association, label: 'has' },
    owns: { type: UML.composition, label: 'owns' },
    aggregates: { type: UML.aggregation, label: 'aggregates' },
    uses: { type: UML.dependency, label: 'uses' },
  },
  params: [
    { name: 'abstract', label: 'abstract', kind: 'boolean', default: false },
    membersParam('attributes', 'attributes', ''),
    membersParam('methods', 'methods', ''),
  ],
  onCreate: (node) => {
    node.label ??= 'NewClass';
  },
  details,
  meta: { uml: 'class' },
});

const interfaceNode = defineNode({
  type: 'uml/interface',
  title: 'Interface',
  category: 'Classifiers',
  color: '#7048e8',
  icon: icons.interface,
  flavor: 'source',
  width: 230,
  tags: ['uml', 'contract', 'protocol'],
  description: 'Methods a class promises to provide',
  inputs: {
    extends: { type: UML.generalization, multiple: true, label: 'extends' },
    referenced: { type: UML.ref, multiple: true, label: 'used by' },
  },
  outputs: {
    implementations: { type: UML.realization, label: 'implemented by' },
    subinterfaces: { type: UML.generalization, label: 'extended by' },
  },
  params: [membersParam('methods', 'methods', '')],
  onCreate: (node) => {
    node.label ??= 'NewInterface';
  },
  details,
  meta: { uml: 'interface' },
});

const enumNode = defineNode({
  type: 'uml/enum',
  title: 'Enum',
  category: 'Classifiers',
  color: '#2b8a3e',
  icon: icons.enum,
  flavor: 'sink',
  width: 200,
  tags: ['uml', 'enumeration', 'values'],
  description: 'A fixed set of named values',
  inputs: { referenced: { type: UML.ref, multiple: true, label: 'used by' } },
  params: [membersParam('values', 'values', 'A\nB')],
  onCreate: (node) => {
    node.label ??= 'NewEnum';
  },
  details,
  meta: { uml: 'enum' },
});

const noteNode = defineNode({
  type: 'uml/note',
  title: 'Note',
  category: 'Annotations',
  color: '#e67700',
  icon: icons.note,
  flavor: 'view',
  width: 200,
  description: 'A comment attached to a classifier',
  outputs: { about: { type: UML.note, label: 'about' } },
  params: [{ name: 'text', label: 'note', kind: 'text', multiline: true, default: 'Explain something here', advanced: true }],
  meta: { uml: 'note' },
});

// ------------------------------------------------------------------ engine

export interface UmlStatus {
  kind: string;
  name: string;
  abstract?: boolean;
  attributes: UmlMember[];
  methods: UmlMember[];
  values?: string[];
  /** Names of classes / interfaces this one extends or implements. */
  parents: string[];
  warnings: string[];
  text?: string;
}

const incomingOf = (graph: Graph, id: string, portType: string) =>
  graph
    .incoming(id)
    .filter((e) => graph.registry?.inputsOf(graph.nodes.get(id)!).find((p) => p.name === e.to.port)?.type === portType)
    .map((e) => graph.nodes.get(e.from.node)!);

/** Superclass chain and every interface (with their parents) a classifier must honour. */
function contracts(graph: Graph, id: string) {
  const supers: NodeInstance[] = [];
  const interfaces = new Map<string, NodeInstance>();
  const addInterface = (n: NodeInstance) => {
    if (interfaces.has(n.id)) return;
    interfaces.set(n.id, n);
    incomingOf(graph, n.id, UML.generalization).forEach(addInterface);
  };
  const seen = new Set<string>();
  let cur: NodeInstance | undefined = graph.nodes.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    incomingOf(graph, cur.id, UML.realization).forEach(addInterface);
    if (kindOf(cur) === 'interface') incomingOf(graph, cur.id, UML.generalization).forEach(addInterface);
    const parent: NodeInstance | undefined = kindOf(cur) === 'class' ? incomingOf(graph, cur.id, UML.generalization)[0] : undefined;
    if (parent) supers.push(parent);
    cur = parent;
  }
  return { supers, interfaces: [...interfaces.values()] };
}

/**
 * Checks a class diagram: every concrete class provides the methods its interfaces (and their
 * parents) require, counting methods inherited from superclasses; interfaces that nothing
 * implements are flagged. Publishes each classifier's parsed members for the view.
 */
export const umlEngine: GraphEngine = {
  name: 'UML checks',
  callable: false,
  async run({ graph, publish }) {
    let classes = 0;
    let interfaces = 0;
    let enums = 0;
    let warnings = 0;
    for (const n of graph.nodes.values()) {
      const kind = kindOf(n);
      if (kind === 'note') {
        publish(n.id, { status: 'ok', outputs: { uml: { kind, name: '', attributes: [], methods: [], parents: [], warnings: [], text: String(n.params.text ?? '') } } });
        continue;
      }
      const status: UmlStatus = {
        kind,
        name: nameOf(n),
        abstract: !!n.params.abstract,
        attributes: kind === 'class' ? parseMembers(n.params.attributes) : [],
        methods: kind === 'enum' ? [] : parseMembers(n.params.methods),
        values: kind === 'enum' ? String(n.params.values ?? '').split('\n').map((v) => v.trim()).filter(Boolean) : undefined,
        parents: [],
        warnings: [],
      };
      if (kind === 'class') {
        classes++;
        const c = contracts(graph, n.id);
        status.parents = [...c.supers.slice(0, 1), ...incomingOf(graph, n.id, UML.realization)].map(nameOf);
        if (!n.params.abstract) {
          const have = new Set([n, ...c.supers].flatMap((x) => parseMembers(x.params.methods).filter((m) => m.isMethod && !m.isAbstract).map((m) => m.name)));
          for (const i of c.interfaces) {
            const missing = parseMembers(i.params.methods).filter((m) => m.isMethod && !have.has(m.name)).map((m) => `${m.name}()`);
            if (missing.length) status.warnings.push(`Missing from ${nameOf(i)}: ${missing.join(', ')}`);
          }
          // Abstract methods of abstract superclasses must be implemented too.
          for (const s of c.supers) {
            const missing = parseMembers(s.params.methods).filter((m) => m.isAbstract && !have.has(m.name)).map((m) => `${m.name}()`);
            if (missing.length) status.warnings.push(`Abstract in ${nameOf(s)}: ${missing.join(', ')}`);
          }
        }
      } else if (kind === 'interface') {
        interfaces++;
        status.parents = incomingOf(graph, n.id, UML.generalization).map(nameOf);
        const used = graph.outgoing(n.id).length > 0;
        if (!used) status.warnings.push('Nothing implements or extends it');
      } else if (kind === 'enum') {
        enums++;
        if (!status.values!.length) status.warnings.push('No values');
      }
      warnings += status.warnings.length;
      publish(n.id, { status: status.warnings.length ? 'error' : 'ok', error: status.warnings.join(' · ') || undefined, outputs: { uml: status } });
    }
    return { outputs: { classes, interfaces, enums, relationships: graph.edges.size, warnings } };
  },
};

// ------------------------------------------------------------------ view

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const memberLine = (m: UmlMember) =>
  `<li class="${m.isAbstract ? 'uml-abstract' : ''}${m.isStatic ? ' uml-static' : ''}"><i>${esc(m.visibility)}</i>${esc(m.name)}${m.isMethod ? `(${esc(m.params ?? '')})` : ''}${m.type ? `<span>: ${esc(m.type)}</span>` : ''}</li>`;

/** UML compartments: stereotype, attributes, operations (or enum values). */
export const umlView = {
  render(el: HTMLElement, r: NodeResult | undefined) {
    const s = r?.outputs?.uml as UmlStatus | undefined;
    if (!s) {
      el.textContent = '';
      return;
    }
    if (s.kind === 'note') {
      el.innerHTML = `<div class="uml-note">${esc(s.text ?? '')}</div>`;
      return;
    }
    const stereo = s.kind === 'interface' ? '«interface»' : s.kind === 'enum' ? '«enumeration»' : s.abstract ? '«abstract»' : '';
    const parents = s.parents.length ? `<div class="uml-parents">${s.kind === 'interface' ? 'extends' : '▷'} ${s.parents.map(esc).join(', ')}</div>` : '';
    const box = (items: string, empty: string) => `<ul class="uml-box">${items || `<li class="uml-empty">${empty}</li>`}</ul>`;
    const body =
      s.kind === 'enum'
        ? box((s.values ?? []).map((v) => `<li>${esc(v)}</li>`).join(''), 'no values')
        : (s.kind === 'class' ? box(s.attributes.map(memberLine).join(''), 'no attributes') : '') + box(s.methods.map(memberLine).join(''), 'no methods');
    el.innerHTML = `<div class="uml">${stereo ? `<div class="uml-stereo">${stereo}</div>` : ''}${parents}${body}</div>`;
  },
};

const css = `
.uml { font-family: var(--_mono); font-size: 11.5px; color: var(--_text); display: flex; flex-direction: column; gap: 4px; }
.uml-stereo { font-family: var(--_font); color: var(--_muted); text-align: center; font-size: 11px; }
.uml-parents { font-family: var(--_font); color: var(--_muted); font-size: 11px; }
.uml-box { list-style: none; margin: 0; padding: 4px 0 0; border-top: 1px solid var(--_border); display: flex; flex-direction: column; gap: 2px; }
.uml-box li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.uml-box i { font-style: normal; color: var(--_muted); display: inline-block; width: 1.2em; }
.uml-box span { color: var(--_muted); }
.uml-abstract { font-style: italic; }
.uml-static { text-decoration: underline; }
.uml-empty { color: var(--_muted); font-family: var(--_font); font-style: italic; }
.uml-note { font-family: var(--_font); font-size: 12px; white-space: pre-wrap; background: color-mix(in srgb, #ffd43b 22%, transparent); padding: 6px 8px; border-radius: 4px; }
.nm-node[data-type-uml="abstract"] .nm-title { font-style: italic; }
`;

// ------------------------------------------------------------------ TypeScript

const TS_VIS: Record<string, string> = { '+': '', '-': 'private', '#': 'protected', '~': '' };

/**
 * TypeScript declarations for a class diagram (or just some of its classifiers). Interfaces
 * become interfaces, classes become classes with `extends` / `implements`, abstract members
 * become abstract, enums become enums. Parents come before children.
 */
export function umlToTypeScript(graph: Graph, _registry: Registry, only?: string[]): string {
  const nodes = [...graph.nodes.values()].filter((n) => ['class', 'interface', 'enum'].includes(kindOf(n)));
  // Parents first: order by depth in the inheritance tree.
  const depth = (n: NodeInstance, seen = new Set<string>()): number => {
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    const ps = [...incomingOf(graph, n.id, UML.generalization), ...incomingOf(graph, n.id, UML.realization)];
    return ps.length ? 1 + Math.max(...ps.map((p) => depth(p, seen))) : 0;
  };
  const chosen = (only ? nodes.filter((n) => only.includes(n.id)) : nodes).sort((a, b) => depth(a) - depth(b) || a.y - b.y || a.x - b.x);
  const out: string[] = [];
  for (const n of chosen) {
    const name = nameOf(n);
    const kind = kindOf(n);
    if (kind === 'enum') {
      const values = String(n.params.values ?? '').split('\n').map((v) => v.trim()).filter(Boolean);
      out.push(`export enum ${name} {\n${values.map((v) => `  ${v},`).join('\n')}\n}`);
      continue;
    }
    const methods = parseMembers(n.params.methods).filter((m) => m.isMethod);
    if (kind === 'interface') {
      const ext = incomingOf(graph, n.id, UML.generalization).map(nameOf);
      const fields = parseMembers(n.params.methods).filter((m) => !m.isMethod);
      out.push(
        `export interface ${name}${ext.length ? ` extends ${ext.join(', ')}` : ''} {\n` +
          [...fields.map((f) => `  ${f.name}: ${f.type ?? 'unknown'};`), ...methods.map((m) => `  ${m.name}(${m.params ?? ''}): ${m.type ?? 'void'};`)].join('\n') +
          `\n}`,
      );
      continue;
    }
    const parent = incomingOf(graph, n.id, UML.generalization)[0];
    const impl = incomingOf(graph, n.id, UML.realization).map(nameOf);
    const abstract = !!n.params.abstract;
    const lines: string[] = [];
    for (const a of parseMembers(n.params.attributes)) {
      const vis = TS_VIS[a.visibility];
      lines.push(`  ${vis ? `${vis} ` : ''}${a.isStatic ? 'static ' : ''}${a.name}${a.type ? `: ${a.type}` : ''};`);
    }
    if (lines.length && methods.length) lines.push('');
    for (const m of methods) {
      const vis = TS_VIS[m.visibility];
      const sig = `${vis ? `${vis} ` : ''}${m.isStatic ? 'static ' : ''}${m.isAbstract && abstract ? 'abstract ' : ''}${m.name}(${m.params ?? ''}): ${m.type ?? 'void'}`;
      lines.push(m.isAbstract && abstract ? `  ${sig};` : `  ${sig} {\n    throw new Error('Not implemented');\n  }`);
    }
    out.push(
      `export ${abstract ? 'abstract ' : ''}class ${name}${parent ? ` extends ${nameOf(parent)}` : ''}${impl.length ? ` implements ${impl.join(', ')}` : ''} {\n${lines.join('\n')}${lines.length ? '\n' : ''}}`,
    );
  }
  return out.join('\n\n') + '\n';
}

const nodes: NodeType[] = [classNode, interfaceNode, enumNode, noteNode].map((n) => ({ ...n, view: umlView }));

export const umlPack = definePack({
  id: 'nodemap/uml',
  title: 'UML',
  portTypes,
  nodes,
  css,
});
