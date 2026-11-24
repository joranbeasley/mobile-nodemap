/**
 * Ports: the standard interfaces between the core and everything around it (hexagonal
 * architecture). The core (graph model, registry, compiler) depends only on these. Every
 * concrete piece (DOM editor, React, <node-map>, ELK, localStorage, the network engine) is an
 * adapter that implements one of them, so any of them can be swapped without touching the core.
 *
 *   driving side (calls the core)        core                       driven side (core calls out)
 *   ─────────────────────────────        ────                       ────────────────────────────
 *   RenderPort: DOM editor,        →   GraphPort      →   EnginePort: dataflow, network…
 *     React, <node-map>                NodeDefinition     StoragePort: memory, localStorage…
 *   CompilerPort: compile(),           Registry           LayoutEnginePort: layered, ELK…
 *     emitSource()                                        RouterPort: orthogonal router
 *                                                         NodeRunner: generated code → nodes
 */
import type { Emitter } from '../core/emitter.js';
import type { GraphEvents } from '../core/graph.js';
import type { GraphEngine, Registry } from '../core/registry.js';
import type { Edge, GraphJSON, NodeInstance, NodeType, PortRef } from '../core/types.js';
import type { LayoutEngine, Point } from '../layout/types.js';

// ---- the two standard shapes everything shares --------------------------------------------

/** The standard node interface: what a node *is* (ports, params, behaviour). Same as NodeType. */
export type NodeDefinition = NodeType;

/** The standard graph interface. `Graph` implements it; adapters should depend on this, not on Graph. */
export interface GraphPort extends Pick<Emitter<GraphEvents>, 'on' | 'off'> {
  readonly nodes: ReadonlyMap<string, NodeInstance>;
  readonly edges: ReadonlyMap<string, Edge>;
  readonly registry?: Registry;
  addNode(type: string, init?: Partial<Omit<NodeInstance, 'type'>>): NodeInstance;
  removeNode(id: string): void;
  moveNode(id: string, x: number, y: number): void;
  setParam(id: string, name: string, value: unknown): void;
  canConnect(from: PortRef, to: PortRef): string | null;
  connect(from: PortRef, to: PortRef, id?: string): Edge;
  disconnect(edgeId: string): void;
  incoming(nodeId: string): Edge[];
  outgoing(nodeId: string): Edge[];
  topoSort(): NodeInstance[];
  toJSON(): GraphJSON;
  load(json: GraphJSON): unknown;
}

// ---- driving ports --------------------------------------------------------------------------

/** Turns a map into executable code. compile() and emitSource() are the built-in adapters. */
export interface CompilerPort {
  /** One plain async function: graph inputs in, graph outputs out. */
  compile(graph: GraphPort | GraphJSON, registry: Registry): (inputs?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** The same function as JS/TS source. */
  emit?(graph: GraphPort | GraphJSON, registry: Registry, options?: { name?: string; lang?: 'ts' | 'js' }): string;
}

/** Everything a UI needs to show and edit a map. */
export interface EditorSession {
  graph: GraphPort;
  registry: Registry;
}

/** A UI that can show a session. NodeEditor (DOM), <NodeMap> (React) and <node-map> are adapters. */
export interface RenderPort {
  mount(container: HTMLElement, session: EditorSession & Record<string, unknown>): RenderHandle;
}

export interface RenderHandle {
  fit(): void;
  autoLayout(): Promise<void>;
  destroy(): void;
}

// ---- driven ports ---------------------------------------------------------------------------

/** How a map runs. Dataflow and the network analysis are adapters; see GraphEngine. */
export type EnginePort = GraphEngine;

/** Where maps are kept. memoryStore() and localStorageStore() are adapters; a server is another. */
export interface StoragePort<T = GraphJSON> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Arranges nodes. layered() and elkLayout() are adapters. */
export type LayoutEnginePort = LayoutEngine;

/** Draws a wire between two port positions around obstacles. Router is the adapter. */
export interface RouterPort {
  route(from: Point, to: Point, owner?: string): Point[] | null;
}

/**
 * Runs one node by type. Code produced by emitSource() calls this for nodes it cannot inline,
 * so generated functions depend on this interface only. registryRunner() is the adapter.
 */
export interface NodeRunner {
  run(type: string, inputs: Record<string, unknown>, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}
