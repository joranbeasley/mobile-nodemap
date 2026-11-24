export * from './types.js';
export { Emitter } from './emitter.js';
export type { Listener } from './emitter.js';
export { Registry } from './registry.js';
export { Graph, ConnectionError } from './graph.js';
export { History } from './history.js';
export type { GraphChange, GraphEvents } from './graph.js';

import type { NodeType } from './types.js';
/** Identity helper that gives you type inference when declaring node types. */
export const defineNode = (def: NodeType): NodeType => def;
