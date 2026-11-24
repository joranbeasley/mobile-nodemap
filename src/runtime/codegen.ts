import type { Graph } from '../core/graph.js';
import type { Registry } from '../core/registry.js';
import type { GraphJSON } from '../core/types.js';
import { INPUT_NODE, OUTPUT_NODE } from './evaluator.js';
import { plan, signature } from './compile.js';

export interface EmitOptions {
  /** Function name. */
  name?: string;
  /** 'ts' adds parameter and return types. */
  lang?: 'ts' | 'js';
  /** Return the single output's value instead of an object (maps with exactly one output). */
  single?: boolean;
  /** Prefix with `export`. Default true. */
  export?: boolean;
}

const TS_TYPES: Record<string, string> = { number: 'number', string: 'string', boolean: 'boolean', list: 'unknown[]' };
const MATH = Object.getOwnPropertyNames(Math);
const ident = (s: string) => s.replace(/[^\w$]/g, '_').replace(/^(\d)/, '_$1');
const prop = (s: string) => (/^[A-Za-z_$][\w$]*$/.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`);
const key = (s: string) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : JSON.stringify(s));

/**
 * Export a map as the source of one standalone JS/TS function.
 *
 * Nodes with an `emit` hook are inlined as plain expressions. Any others are called through
 * the `runner` argument (the NodeRunner port), so the generated function depends on nothing
 * but that interface. A map made only of inlinable nodes needs no runner at all.
 */
export function emitSource(source: Graph | GraphJSON, registry: Registry, opts: EmitOptions = {}): string {
  const steps = plan(source, registry);
  const sig = signature(source);
  const ts = opts.lang !== 'js';
  const name = ident(opts.name ?? 'compiledMap');
  const single = opts.single ?? false;
  if (single && sig.outputs.length !== 1) throw new Error(`single: true needs exactly one output; this map has ${sig.outputs.length}`);

  const v = (id: string) => `n_${ident(id)}`;
  const body: string[] = [];
  const needsRunner: string[] = [];
  const inlined: string[] = [];
  const returns: string[] = [];
  for (const step of steps) {
    const { node, def } = step;
    const args: Record<string, string> = {};
    for (const b of step.bindings) {
      const refs = b.sources.map((s) => `${v(s.node)}${prop(s.port)}`);
      args[b.port.name] = b.port.multiple ? `[${refs.join(', ')}]` : refs[0] ?? JSON.stringify(b.constant ?? null);
    }
    const label = `// ${def.title ?? def.type}${node.label ? ` "${node.label}"` : ''}`;
    if (node.type === INPUT_NODE) {
      const n = String(node.params.name);
      body.push(`  const ${v(node.id)} = { value: inputs${prop(n)} ?? ${JSON.stringify(node.params.value ?? null)} }; ${label} ${n}`);
    } else if (node.type === OUTPUT_NODE) {
      returns.push(`${key(String(node.params.name))}: ${args.value}`);
    } else if (def.emit) {
      const outs = def.emit(args, node.params);
      inlined.push(...Object.values(outs));
      body.push(`  const ${v(node.id)} = { ${Object.entries(outs).map(([k, e]) => `${key(k)}: ${e}`).join(', ')} }; ${label}`);
    } else {
      needsRunner.push(def.type);
      const argObj = `{ ${Object.entries(args).map(([k, e]) => `${key(k)}: ${e}`).join(', ')} }`;
      body.push(`  const ${v(node.id)} = await runner.run(${JSON.stringify(def.type)}, ${argObj}, ${JSON.stringify(node.params)}); ${label}`);
    }
  }

  const code = body.join('\n');
  const inlineCode = inlined.join('\n');
  const usedMath = MATH.filter((m) => new RegExp(`(?<![\\w$.])${m}(?![\\w$])`).test(inlineCode));
  const inputType = `{ ${sig.inputs.map((p) => `${key(p.name)}?: ${TS_TYPES[p.type ?? ''] ?? 'unknown'}`).join('; ')} }`;
  const resultType = single ? 'unknown' : `{ ${sig.outputs.map((p) => `${key(p.name)}: unknown`).join('; ')} }`;
  const runnerParam = needsRunner.length ? (ts ? ', runner: NodeRunner' : ', runner') : '';
  const header = `${opts.export === false ? '' : 'export '}async function ${name}(inputs${ts ? `: ${inputType}` : ''} = {}${runnerParam})${ts ? `: Promise<${resultType}>` : ''} {`;
  const doc = [
    '/**',
    ` * Generated from a node map${registry.id ? ` (${registry.id})` : ''}.`,
    ...(sig.inputs.length ? [` * Inputs: ${sig.inputs.map((p) => `${p.name}${p.type ? ` (${p.type})` : ''}`).join(', ')}.`] : []),
    ...(needsRunner.length
      ? [` * Calls these nodes through \`runner\` (a NodeRunner, e.g. registryRunner(registry)): ${[...new Set(needsRunner)].join(', ')}.`]
      : [' * Self-contained: no runtime needed.']),
    ' */',
  ];
  const ret = single ? `  return ${returns[0]?.split(': ').slice(1).join(': ') ?? 'undefined'};` : `  return { ${returns.join(', ')} };`;
  return [
    ...doc,
    header,
    ...(usedMath.length ? [`  const { ${usedMath.join(', ')} } = Math;`] : []),
    code,
    ret,
    '}',
    '',
  ].join('\n');
}
