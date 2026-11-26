# React

`import { NodeMap, useRegistry, useGraph, useGraphValue, useEvaluator, useEvaluation, reactView } from 'mobile-nodemap/react'`

React 18 and 19, as optional peer dependencies.

## `<NodeMap>`

```tsx
<NodeMap
  graphType={mathGraph}            // or registry={…}
  graph={graph}                    // optional: one you own (useGraph); otherwise seeded from defaultValue
  defaultValue={json}
  evaluator={evaluator}            // optional: yours (useEvaluator), or false to not run nodes
  wires="smart" direction="auto" layout={layered()} toolbar placement   // the graph type's direction, views (tabs), plugins and edgeStyle apply by default
  readOnly={false}                 // view only; can change while mounted
  theme="midnight"                 // 'light' | 'dark' | a theme id or object | { light, dark }
  autoLayout                       // tidy once on mount (defaults to the graph type's editor.autoLayout)
  onChange={(json, change) => {}}
  onSelect={(sel) => {}}
  onEvaluate={(report) => {}}
  className style
  ref={editorRef}                  // the NodeEditor
/>
```

It fills its box; give it a height.

## Hooks

| Hook | Returns |
| --- | --- |
| `useRegistry(graphType)` | A registry, created once per graph type. |
| `useGraph(registry, initial?)` | A `Graph` for the component's lifetime. |
| `useGraphValue(graph)` | The graph's JSON; re-renders on every change. |
| `useEvaluator(graph, registry)` | A stable `Evaluator`. |
| `useEvaluation(evaluator, inputs?)` | `{ running, outputs, results, errors, durationMs }`. When `inputs` changes, the map re-runs with them as graph inputs. |

## `reactView(Component)`

Render a node's preview with React:

```tsx
registry.define({ type: 'view/gauge', inputs: { value: 'number' }, run: ({ value }) => ({ value }), view: reactView(Gauge) });
function Gauge({ result, node }: NodeViewProps) { … }
```
