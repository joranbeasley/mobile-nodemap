/**
 * Adapters: concrete implementations of the ports in ../ports. Swap any of them.
 */
import type { Registry } from '../core/registry.js';
import type { GraphJSON } from '../core/types.js';
import { compile, dataflowEngine } from '../runtime/compile.js';
import { emitSource } from '../runtime/codegen.js';
import { NodeEditor, type EditorOptions } from '../editor/editor.js';
import type { CompilerPort, EditorSession, NodeRunner, RenderHandle, RenderPort, StoragePort } from '../ports/index.js';
import { Graph } from '../core/graph.js';

export { dataflowEngine };
export { networkEngine } from '../packs/network.js';
export { layered } from '../layout/layered.js';
export { elkLayout } from '../layout/elk.js';
export { Router } from '../layout/router.js';

/** StoragePort in memory. Good for tests and server-side use. */
export function memoryStore<T = GraphJSON>(seed: Record<string, T> = {}): StoragePort<T> {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  return {
    get: async (k) => (data.has(k) ? structuredClone(data.get(k)!) : undefined),
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => void data.delete(k),
    keys: async () => [...data.keys()],
  };
}

/** StoragePort over localStorage (or any Storage). Read/write failures (private mode) are swallowed. */
export function localStorageStore<T = GraphJSON>(prefix = 'nodemap:', storage?: Storage): StoragePort<T> {
  const s = () => storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  const safe = <R>(fn: () => R, fallback: R) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    get: async (k) => safe(() => JSON.parse(s()?.getItem(prefix + k) ?? 'null') ?? undefined, undefined),
    put: async (k, v) => safe(() => s()?.setItem(prefix + k, JSON.stringify(v)), undefined),
    delete: async (k) => safe(() => s()?.removeItem(prefix + k), undefined),
    keys: async () =>
      safe(() => {
        const st = s();
        if (!st) return [];
        return Array.from({ length: st.length }, (_, i) => st.key(i)!).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      }, [] as string[]),
  };
}

/** NodeRunner backed by a registry: lets generated code call any node type. */
export function registryRunner(registry: Registry): NodeRunner {
  return {
    async run(type, inputs, params) {
      const def = registry.require(type);
      const node = { id: type, type, x: 0, y: 0, params };
      return (await def.run?.(inputs, { node, params, graphInputs: {}, signal: new AbortController().signal })) ?? {};
    },
  };
}

/** The built-in compiler as a CompilerPort. */
export const defaultCompiler: CompilerPort = {
  compile: (graph, registry) => compile(graph instanceof Graph ? graph : (graph as GraphJSON), registry),
  emit: (graph, registry, options) => emitSource(graph instanceof Graph ? graph : (graph as GraphJSON), registry, options),
};

/** The DOM editor as a RenderPort. */
export const domEditor: RenderPort = {
  mount(container, session): RenderHandle {
    const opts = session as unknown as Omit<EditorOptions, "graph"> & EditorSession;
    const editor = new NodeEditor(container, { ...opts, graph: opts.graph as Graph, registry: opts.registry });
    return { fit: () => editor.fit({ minScale: 0 }), autoLayout: () => editor.autoLayout(), destroy: () => editor.destroy() };
  },
};
