# Ports and adapters

`import type { GraphPort, NodeDefinition, … } from 'mobile-nodemap'`

The standard interfaces between the core and everything else ([ADR 0002](../adr/0002-ports-and-adapters.md)). Depend on these, not on concrete classes, and any adapter can be swapped.

## Ports

| Port | Shape | Direction |
| --- | --- | --- |
| `GraphPort` | `nodes`, `edges`, `registry`; `addNode`, `removeNode`, `moveNode`, `setParam`, `canConnect`, `connect`, `disconnect`, `incoming`, `outgoing`, `topoSort`, `toJSON`, `load`, `on`/`off` | core |
| `NodeDefinition` | `= NodeType` ([nodes](nodes.md)) | core |
| `CompilerPort` | `compile(graph, registry) → (inputs?) => Promise<outputs>`; `emit?(graph, registry, { name?, lang? }) → string` | driving |
| `RenderPort` | `mount(container, { graph, registry, … }) → RenderHandle` (`fit`, `autoLayout`, `destroy`) | driving |
| `EnginePort` | `= GraphEngine` ([graph types](graph-types.md#engines)) | driven |
| `StoragePort<T = GraphJSON>` | `get(key)`, `put(key, value)`, `delete(key)`, `keys()`, all async | driven |
| `LayoutEnginePort` | `= LayoutEngine` ([layout](layout.md)) | driven |
| `RouterPort` | `route(from, to, owner?) → Point[] \| null` | driven |
| `NodeRunner` | `run(type, inputs, params) → Promise<outputs>`, used by generated code | driven |

## Adapters

| Adapter | Implements |
| --- | --- |
| `Graph` | `GraphPort` |
| `defaultCompiler` (`compile` + `emitSource`) | `CompilerPort` |
| `domEditor` (`NodeEditor`), `<NodeMap>`, `<node-map>` | `RenderPort` |
| `dataflowEngine`, `networkEngine` | `EnginePort` |
| `memoryStore(seed?)`, `localStorageStore(prefix = 'nodemap:', storage?)` | `StoragePort` |
| `layered()`, `elkLayout(elk)` | `LayoutEnginePort` |
| `Router` | `RouterPort` |
| `registryRunner(registry)` | `NodeRunner` |

## Writing an adapter

```ts
// Keep maps on a server.
const serverStore: StoragePort = {
  get: (k) => fetch(`/maps/${k}`).then((r) => (r.ok ? r.json() : undefined)),
  put: (k, v) => fetch(`/maps/${k}`, { method: 'PUT', body: JSON.stringify(v) }).then(() => {}),
  delete: (k) => fetch(`/maps/${k}`, { method: 'DELETE' }).then(() => {}),
  keys: () => fetch('/maps').then((r) => r.json()),
};

// Run generated code against a remote node service.
const remoteRunner: NodeRunner = {
  run: (type, inputs, params) => fetch('/run', { method: 'POST', body: JSON.stringify({ type, inputs, params }) }).then((r) => r.json()),
};
```
