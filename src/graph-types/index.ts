import { registerGraphType } from '../core/graph-type.js';
import { mathGraph } from './math.js';
import { networkGraph } from './network.js';
import { functionGraph, functionIssues } from './function.js';

export { mathGraph, networkGraph, functionGraph, functionIssues };

/** The graph types that ship with the library (registered by id on import). */
export const builtinGraphTypes = [mathGraph, networkGraph, functionGraph].map(registerGraphType);
