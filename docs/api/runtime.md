# Runtime

`import { Evaluator, compile, compileFunction, signature, emitSource } from 'mobile-nodemap/runtime'`

## `Evaluator`

Runs a graph live, for editors and dashboards.

```ts
const evaluator = new Evaluator(graph, registry);
const report = await evaluator.run({ inputs?: Record<string, unknown>, force?: boolean });
const stop = evaluator.live(debounceMs = 30);   // re-run on every change (except moves)
evaluator.invalidate(nodeId?);                  // drop cached results
evaluator.inputValues(node, results?);          // what each input port receives
evaluator.results;                              // Map<nodeId, NodeResult>, latest
evaluator.graphInputs;                          // inputs of the last run
```

Behaviour:

- **Dataflow**: nodes run as soon as their inputs resolve, in parallel.
- **Memoised**: a node re-runs only when its params or input values change (`pure: false` opts out).
- **Cancellable**: a new run aborts the previous one through `ctx.signal`.
- **Errors**: a failing node skips everything downstream.
- **Engines**: if `registry.engine` is set, the run is delegated to it.

```ts
interface EvalReport {
  outputs: Record<string, unknown>;          // graph/output values (or the engine's outputs)
  results: Map<string, NodeResult>;
  errors: { node: string; error: string }[];
  durationMs: number;
  executed: string[];                        // nodes that actually ran
  aborted: boolean;
}
```

Events: `start` `{ runId }`, `node` `{ id, result }` (including `status: 'running'`) and `done` (the report; not fired for aborted runs).

## `compile(graph, registry, name?)`

Returns **one plain async function**:

```ts
const fn: (inputs?: Partial<I>, options?: { signal?: AbortSignal }) => Promise<O> = compile(graph, registry, 'cylinder');
await fn({ radius: 2, height: 5 });   // { volume: 62.83… }
fn.name;                              // 'cylinder'
```

It composes the nodes' `run` functions directly. There is no evaluator, cache or editor, and the function has no extra properties. Graph inputs come from `graph/input` nodes by name, and the result holds `graph/output` values by name. Failures throw `NodeRunError`.

## `compileFunction(graph, registry, name?)`

For maps with exactly one output: it returns that value instead of an object. It throws if the map has no outputs or more than one.

## `signature(graph)`

```ts
signature(graph) // { inputs: PortDef[] (name, type, default), outputs: PortDef[] }, top to bottom
```

## `emitSource(graph, registry, options?)`

The map as the source of one standalone function.

```ts
emitSource(graph, registry, {
  name?: 'compiledMap',
  lang?: 'ts' | 'js',      // 'ts' adds parameter and return types
  single?: false,          // return the single output's value
  export?: true,
});
```

- Nodes with an `emit` hook are inlined.
- Other nodes are called as `await runner.run(type, inputs, params)`. Pass a `NodeRunner` such as `registryRunner(registry)`.
- The doc comment says whether the function is self-contained or which node types it needs a runner for.

## `NodeRunError`

`class NodeRunError extends Error { nodeId: string; nodeType: string }`

## Lower-level pieces

| Export | |
| --- | --- |
| `plan(graph, registry)` | Resolved steps in dependency order (bindings, constants and sources). Shared by `compile`, `dataflowEngine` and `emitSource`. |
| `execute(steps, registry, inputs, signal?, onNode?)` | Runs a plan and returns `Map<nodeId, outputs>`. |
| `dataflowEngine` | The dataflow behaviour as a `GraphEngine` (no memoisation). |
| `graphNode({ type, title?, category?, color?, graph, registry })` | Wraps any map as a node type, with all its outputs. For single-output maps with validation and a name, prefer `compileNode`. |
| `compileExpression(vars, expr)` | The expression compiler used by `math/expression` and `list/map`. It runs unsandboxed. |
| `formatValue(v, max?)` | Short display text for a value. |
| `INPUT_NODE`, `OUTPUT_NODE` | `'graph/input'`, `'graph/output'`. |
