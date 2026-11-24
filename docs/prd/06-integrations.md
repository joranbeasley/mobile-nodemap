# 06. React and custom element integrations

## Problem

Apps are built with React, with other frameworks, or with none. The editor has to fit in all of them without wrappers people write themselves.

## Requirements

| # | Requirement | Status |
| --- | --- | --- |
| I1 | `<NodeMap>` with `graphType` or `registry`, a controlled or own graph, evaluator, wires, layout, theme, autoLayout and callbacks; its ref is the editor | Shipped |
| I2 | Hooks: `useRegistry`, `useGraph`, `useGraphValue`, `useEvaluator`, `useEvaluation(evaluator, inputs)` | Shipped |
| I3 | `reactView(Component)` renders node previews with React | Shipped |
| I4 | `<node-map>` reads inline JSON, renders in a shadow root and emits `change`, `select` and `evaluate` | Shipped |
| I5 | Element attributes `graph-type`, `theme`, `wires`, `auto-layout`, `no-toolbar`, `no-eval`; methods `autoLayout()`, `fit()`, `run()`, `call()` | Shipped |
| I6 | The DOM editor is also exposed as a `RenderPort` adapter (`domEditor`) | Shipped |

## Open questions

- Vue and Svelte wrappers, which are thin over the element.
- Server-side rendering a static preview of a map.
