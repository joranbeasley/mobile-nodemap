# Graph types and packs

## `defineGraphType(def): GraphType`

A kind of map: which nodes it offers, which wires are legal, and how it runs.

```ts
const lab = defineGraphType({
  id: 'acme/lab', title: 'Lab', description?, icon?,
  extends: [mathGraph, 'network'],     // objects, or ids of registered types
  packs: [unitsPack],
  nodes: [myNode],
  portTypes: [...], paramKinds: [...],
  exclude: ['async/*', 'text/case'],
  rules: { ... },                      // below
  engine: myEngine,                    // replaces dataflow
  editor: { wires: 'smart', autoLayout: true },
  examples: [{ id, name, description?, graph }],
  setup(registry) { ... },             // last word
});
```

| `GraphType` member | |
| --- | --- |
| `createRegistry()` | A fresh `Registry`: parents first, then port types, param kinds, packs, nodes, `exclude`, rules, engine and `setup`. |
| `extend(def)` | A new graph type based on this one. |
| all `GraphTypeDef` fields | |

## Registering

| Function | |
| --- | --- |
| `registerGraphType(type)` | Make it findable by id: saved JSON, `extends: ['id']` and `<node-map graph-type>`. Returns the type. |
| `getGraphType(id)` / `listGraphTypes()` | |
| `registryFor(json, fallback?)` | The registry for a saved map, from its `type`. Throws for unknown types. |

Built-ins are registered on import: `math`, `network` and `function`.

## Rules

```ts
interface GraphRules {
  allowCycles?: boolean;                                         // default false
  canConnect?(from: ConnectionEnd, to: ConnectionEnd, graph): string | null | void;
  canAddNode?(type: string, graph): string | null | void;       // vetoed types are hidden from the add menu
  validate?(graph): GraphIssue[];
}
interface ConnectionEnd extends PortRef { def: PortDef; nodeType: string }
interface GraphIssue { level: 'error' | 'warning'; message: string; node?: string }
```

## Engines

```ts
interface GraphEngine {
  name?: string;
  callable?: boolean;            // can maps be called as functions? (tools hide "Call" when false)
  run(ctx: EngineContext): Promise<{ outputs?: Record<string, unknown> } | void>;
}
interface EngineContext {
  graph: Graph; registry: Registry; inputs: Record<string, unknown>; signal: AbortSignal;
  publish(nodeId: string, result: NodeResult): void;     // show a node's result in the editor
}
```

`Evaluator` uses `registry.engine` when it is set. The shipped engines are `dataflowEngine` and `networkEngine`.

## `definePack(pack): NodePack`

What a library publishes.

```ts
interface NodePack {
  id: string; title?: string; version?: string;
  nodes?: NodeSpec[];
  portTypes?: PortTypeDef[];
  paramKinds?: ParamKind[];
  conversions?: [from, to][];
  css?: string;                  // injected once per document or shadow root
  setup?(registry): void;
}
```

Install it with `registry.use(pack)`, or list it in a graph type's `packs`.

## Built-in graph types and packs

| Export | id | |
| --- | --- | --- |
| `mathGraph` | `math` | Dataflow; `mathPack` (`nodemap/math`): values, math, logic, text, lists, async, display, graph I/O, constants, remap, sum all, plot function. Conversions number→string and boolean→number. |
| `networkGraph` | `network` | `networkPack` (`nodemap/network`): internet, router, firewall, switch, Wi-Fi access point, server, laptop, phone; port type `link`; `networkEngine`; `allowCycles`; endpoints can't connect straight to the internet. Every device has editable `up`, `ip`, `latency` and `bandwidth`, and a name (`label`). Servers add `kind` (Application, Web, Database, File / NAS, Mail, DNS, Media, Game, Backup, Other: `SERVER_TYPES`), `cores`, `memory` (GB), `storage` (GB) and `os`; laptops and phones add `os`. `deviceSpecs(node)` gives the one-line summary shown on the node. **Data stores** (`net/disk`, `net/database`, `net/cache`, `net/bucket`, `net/queue`; `meta.role: 'data'`; derived from `networkDataStore`) attach to a server's `data` output (port type `data`). They have `up`, `size` / `used` (GB; size 0 = unlimited) and `latency`, plus their own settings: disk type and RAID; database engine and role; cache engine and hit rate; bucket provider and versioning; queue engine, backlog and retention. `validate` warns about bad or duplicate IPv4 addresses (`ipIssues(nodes)`) and data stores not attached to a server. |
| `functionGraph` | `function` | Extends math. Input leaves are arguments and exactly one Output is required (`canAddNode` and `validate` via `functionIssues`). See [library](library.md). |
| `stdlib` | | The math node types as a plain array (kept for compatibility). |
| `networkDevice` | | The base device node, for `extendNode`. |
| `networkStatusView` | | The device status view, for reuse. |
| `builtinGraphTypes` | | `[mathGraph, networkGraph, functionGraph]`. |

`networkEngine` publishes `outputs.status` for each device: `{ state: 'source' | 'online' | 'offline' | 'down' | 'blocking', latency?, hops?, bandwidth?, redundant?, ip?, ipIssue? }`.

Data stores get `{ state: 'available' | 'unavailable' | 'down', hosts, latency, redundant, usage, usedGb, sizeGb, warning? }`:

- **Available** while any attached server is online, reached at that server's latency plus their own. `redundant` means 2+ online servers.
- **Warnings**: 85%+ full, a cache hit rate under 80%, or a queue backlog over 10,000.
- Data attachments don't count as cables for device reachability.

Its summary outputs are `{ online, offline, worstLatency, dataAvailable, dataUnavailable }`.
