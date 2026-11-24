import { registerGraphType } from '../core/graph-type.js';
import { mathGraph } from './math.js';
import { networkGraph } from './network.js';
import { functionGraph, functionIssues } from './function.js';
import { umlGraph } from './uml.js';
import { dramaGraph } from './drama.js';

export { mathGraph, networkGraph, functionGraph, functionIssues, umlGraph, dramaGraph };

/** The graph types that ship with the library (registered by id on import). */
export const builtinGraphTypes = [mathGraph, networkGraph, functionGraph, umlGraph, dramaGraph].map(registerGraphType);
