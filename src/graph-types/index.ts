import { registerGraphType } from '../core/graph-type.js';
import { mathGraph } from './math.js';
import { networkGraph } from './network.js';

export { mathGraph, networkGraph };

/** The graph types that ship with the library (registered by id on import). */
export const builtinGraphTypes = [mathGraph, networkGraph].map(registerGraphType);
