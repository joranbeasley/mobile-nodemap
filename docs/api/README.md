# API reference

Everything public in `mobile-nodemap`, grouped by module. All of it is also exported from the package root (`import { … } from 'mobile-nodemap'`), except the React bindings (`mobile-nodemap/react`) and the self-registering element entry (`mobile-nodemap/element`).

| Page | Covers | Entry point |
| --- | --- | --- |
| [Core](core.md) | `Graph`, `GraphJSON`, `History`, `Emitter`, `Registry` | `mobile-nodemap/core` |
| [Nodes](nodes.md) | `defineNode`, `extendNode`, `NodeType`, ports, params, param kinds, port types, details | `mobile-nodemap/core` |
| [Graph types and packs](graph-types.md) | `defineGraphType`, `definePack`, rules, engines, built-in graph types | root |
| [Runtime](runtime.md) | `Evaluator`, `compile`, `compileFunction`, `emitSource`, `signature`, `plan`, `execute` | `mobile-nodemap/runtime` |
| [Library](library.md) | `compileNode`, `NodeLibrary` | root |
| [Editor](editor.md) | `NodeEditor`: options, methods, events, styles | `mobile-nodemap/editor` |
| [Layout](layout.md) | `layered`, `elkLayout`, `Router`, `findFreeSpot`, geometry | `mobile-nodemap/layout` |
| [Themes](themes.md) | `defineTheme`, `registerTheme`, flavors, built-in themes | root |
| [Ports and adapters](ports-and-adapters.md) | the standard interfaces and their implementations | root |
| [React](react.md) | `<NodeMap>`, hooks, `reactView` | `mobile-nodemap/react` |
| [Custom element](element.md) | `<node-map>` | `mobile-nodemap/element` |

## Conventions

- **Ids are namespaced strings**: `math/add`, `net/router`, `acme/palette`, `lib/cylinder-volume`.
- **Everything saved is JSON**: graphs (`GraphJSON`), library entries (`LibraryEntry[]`) and themes (`Theme`).
- **Definitions are values**: `createRegistry()` builds a fresh registry each time, and nothing global changes unless you call a `register…` function.
- **Async is the default** for anything that runs nodes (`run`, `compile`, engines). Synchronous `run` functions are fine; they are awaited.
- **Errors explain themselves**:
  - `ConnectionError` for wiring and rule vetoes;
  - `NodeRunError` (with `nodeId`) for runtime failures;
  - `GraphIssue[]` from `graph.validate()` for problems people can fix.

Why things are shaped this way: [../adr](../adr). What each area must do: [../prd](../prd).
