# Core

`import { Graph, History, Registry, Emitter, ConnectionError } from 'mobile-nodemap/core'`

No DOM, no dependencies. Runs in browsers, Node and workers.

## `Graph`

The node map: nodes with positions and params, and edges between ports. Implements [`GraphPort`](ports-and-adapters.md).

```ts
const graph = new Graph(registry?);
const graph = Graph.fromJSON(json, registry?);
```

Pass a registry to get port validation, type checks, rules and migrations.

### Properties

| Property | Type | |
| --- | --- | --- |
| `nodes` | `Map<string, NodeInstance>` | read it; change it through the methods |
| `edges` | `Map<string, Edge>` | |
| `registry` | `Registry \| undefined` | |
| `meta` | `Record<string, unknown>` | free-form, saved in JSON |

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `addNode(type, init?)` | `NodeInstance` | `init`: `{ id?, x?, y?, params?, label? }`. Applies param defaults, `version` and `onCreate`. Throws `ConnectionError` if `rules.canAddNode` vetoes it. |
| `removeNode(id)` | `void` | Also removes its edges. |
| `moveNode(id, x, y)` | `void` | |
| `setParam(id, name, value)` | `void` | Also sets inline values of unconnected inputs (same namespace). Drops edges whose ports vanished (dynamic `ports()`). |
| `canConnect(from, to)` | `string \| null` | The reason it can't connect, or `null`. Checks ports, types, `multiple`, `rules.canConnect` and loops (unless `allowCycles`). |
| `connect(from, to, id?)` | `Edge` | Throws `ConnectionError`. Replaces the existing wire on a single input. |
| `disconnect(edgeId)` | `void` | |
| `incoming(nodeId)` / `outgoing(nodeId)` | `Edge[]` | |
| `reaches(start, target)` | `boolean` | Is `target` downstream of `start`? |
| `downstream(id)` | `Set<string>` | Including `id`. |
| `topoSort(subset?)` | `NodeInstance[]` | Throws on cycles. |
| `validate()` | `GraphIssue[]` | From the graph type's `rules.validate`. |
| `clear()` | `void` | |
| `toJSON()` | `GraphJSON` | Includes `type` when the registry has an id. |
| `load(json)` | `this` | Runs node `migrate` for older versions. Emits one `load` change. |

### Events

`graph.on('change', (c: GraphChange) => …)` returns an unsubscribe function. `c.kind` is one of:

- `node:add`, `node:remove`, `node:move`: with `node`;
- `node:params`: with `node` and `name`;
- `edge:add`, `edge:remove`: with `edge`;
- `load`.

## Data shapes

```ts
interface GraphJSON {
  version: 1;
  type?: string;                 // graph type id
  nodes: NodeInstance[];
  edges: Edge[];
  meta?: Record<string, unknown>;
}
interface NodeInstance { id: string; type: string; x: number; y: number; params: Record<string, unknown>; label?: string; v?: number }
interface Edge { id: string; from: PortRef; to: PortRef }
interface PortRef { node: string; port: string }
interface NodeResult { status: 'ok' | 'error' | 'running' | 'skipped'; outputs?: Record<string, unknown>; error?: string; durationMs?: number }
```

## `ConnectionError`

Thrown by `connect` and `addNode` when a connection or node is not allowed. Its `message` is written for people: "Type mismatch: string → number", "A function has exactly one Output".

## `History`

Snapshot undo and redo. Bursts of changes (a slider drag) collapse into one step.

```ts
const history = new History(graph, settleMs = 300, limit = 100);
history.undo(); history.redo(); history.commit(); history.reset(); history.dispose();
history.canUndo; history.canRedo;
```

The editor creates one unless `history: false`.

## `Registry`

What a map can contain. Usually built by a graph type (`mathGraph.createRegistry()`), but it can be assembled by hand.

| Member | Notes |
| --- | --- |
| `new Registry(nodes?)` | |
| `id`, `title` | Graph type identity; `id` goes into saved JSON. |
| `rules: GraphRules` | See [graph types](graph-types.md#rules). |
| `engine?: GraphEngine` | Replaces dataflow evaluation. |
| `define(node)` | A `NodeType` or a shorthand spec. |
| `remove(...patterns)` | Ids, or `'ns/*'`. |
| `use(nodes \| pack)` | Adds node types, or a `NodePack` with its port types, param kinds, conversions and CSS. |
| `get(type)` / `require(type)` / `list()` / `categories()` | `require` throws for unknown types. |
| `definePortType(def)` / `portType(id)` / `portTypes()` | |
| `defineParamKind(kind)` / `paramKind(id)` | |
| `allowConversion(from, to)` / `isCompatible(from, to)` / `coerce(value, from, to)` | `any` is compatible with everything. |
| `inputsOf(node)` / `outputsOf(node)` | Resolves dynamic `ports(params)`. |
| `styles()` | `[packId, css][]` contributed by packs. |
| `packs` | Ids of installed packs. |
| `merge(other)` / `extend()` | Combine, or copy so you can add without touching the original. |
| `Registry.isPrimitive(type)` | `number`, `string`, `boolean`. |

## `Emitter<Events>`

The tiny typed emitter that Graph, Evaluator, NodeEditor and NodeLibrary extend: `on(event, fn) → off()` and `off(event, fn)`.
