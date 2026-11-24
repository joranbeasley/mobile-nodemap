# mobile-nodemap

A small, dependency-free TypeScript library for building **node maps** (node graphs) that work well on phones, plus a runtime that **evaluates** them.

- **`mobile-nodemap/core`**: the data model. `Graph` (nodes, ports, edges, JSON), `Registry` (node type definitions), `History` (undo/redo). No DOM.
- **`mobile-nodemap/runtime`**: the evaluator. Memoised, async, cancellable execution; `compile()` turns a map into a plain async function; `graphNode()` turns a map into a reusable node; `stdlib` has about 30 ready-made nodes. No DOM.
- **`mobile-nodemap/editor`**: `NodeEditor`, a touch-first DOM/SVG editor with pinch zoom, drag or tap-to-connect wiring, a long-press add menu, live results and undo.

The demo playground is in `docs/demo.html` (one self-contained file).

## Quick start

```ts
import { Graph, Registry, Evaluator, NodeEditor, stdlib, defineNode } from 'mobile-nodemap';

const registry = new Registry(stdlib).define(
  defineNode({
    type: 'units/f-to-c',
    title: '°F → °C',
    category: 'Custom',
    inputs: [{ name: 'f', type: 'number', default: 72 }],
    outputs: [{ name: 'c', type: 'number' }],
    run: ({ f }) => ({ c: ((f - 32) * 5) / 9 }),
  }),
);

const graph = new Graph(registry);
const evaluator = new Evaluator(graph, registry);
new NodeEditor(document.getElementById('canvas')!, { graph, registry, evaluator });
```

Give the container a size (for example `height: 100dvh`). The editor injects its own stylesheet.

## Defining nodes

```ts
defineNode({
  type: 'math/lerp',              // unique id
  title: 'Lerp', category: 'Math', color: '#3b5bdb', description: 'Shown in the add menu',
  inputs:  [{ name: 'a', type: 'number', default: 0 }, { name: 'b', type: 'number', default: 1 }, { name: 't', type: 'number' }],
  outputs: [{ name: 'out', type: 'number' }],
  params:  [{ name: 'clamp', kind: 'boolean', default: true }],   // number | text | boolean | select
  run: async ({ a, b, t }, { params, signal, graphInputs, node }) => ({
    out: a + (b - a) * (params.clamp ? Math.min(1, Math.max(0, t)) : t),
  }),
  pure: true,                     // false = never reuse cached results (random, clock, fetch)
  view: { render(el, result) { /* custom preview inside the node */ } },
  ports: (params) => ({ inputs: [...] }),   // optional: ports that depend on params
});
```

- **Ports** have a `type` string. `any` connects to everything. Add conversions with `registry.allowConversion('number', 'string')`.
- **Unconnected inputs** of type `number`, `string`, `boolean` or `any` get an inline editor on the node. Their values live in `node.params[inputName]`, and fall back to `default`.
- `run` may be sync or async. Throwing marks the node as errored and skips its downstream nodes.

## Evaluating

```ts
const evaluator = new Evaluator(graph, registry);
const report = await evaluator.run({ inputs: { x: 3 } });
report.outputs;   // values of graph/output nodes, by name
report.results;   // Map<nodeId, { status, outputs, error, durationMs }>
report.executed;  // ids that actually ran (others came from cache)

evaluator.on('node', ({ id, result }) => {});  // per-node progress
const stop = evaluator.live();                 // re-run on every graph change
```

Nodes start as soon as their inputs are ready, so independent async branches run in parallel. A node re-runs only when its params or input values change. Starting a run aborts the previous one (`ctx.signal`).

## Maps as functions

Add `graph/input` and `graph/output` nodes, then:

```ts
import { compile, graphNode } from 'mobile-nodemap/runtime';

const area = compile(graph, registry);          // (inputs) => Promise<outputs>
await area({ radius: 2 });                      // { area: 12.566… }
area.inputs; area.outputs;                      // the signature

registry.define(graphNode({ type: 'fn/area', title: 'Circle area', graph, registry }));
```

`graphNode()` lets people build their own nodes out of nodes.

## Editor gestures

| Action | Touch | Mouse / keyboard |
| --- | --- | --- |
| Pan | drag the background | drag the background, two-finger scroll |
| Zoom | pinch | ctrl + wheel, trackpad pinch |
| Move a node | drag it | drag it |
| Connect | drag port → port, or tap a port then another port (or a node) | same |
| Rewire | drag a wire's end off an input | same |
| Add connected node | drop a wire on empty canvas | same |
| Add node | long-press the background, or **+** | **+**, <kbd>A</kbd> or <kbd>Space</kbd> |
| Delete | select, then the bin | <kbd>Delete</kbd> |
| Undo / redo | toolbar | <kbd>Ctrl/⌘ Z</kbd>, <kbd>Ctrl/⌘ Shift Z</kbd> |

Ports have a 44px touch target, form fields use 16px text (no iOS focus zoom), and the add menu is a bottom sheet on phones.

## Theming

Every colour is a CSS variable on `.nm-root`: `--nm-bg`, `--nm-dot`, `--nm-node`, `--nm-node-2`, `--nm-border`, `--nm-text`, `--nm-muted`, `--nm-accent`, `--nm-wire`, `--nm-danger`, `--nm-font`, `--nm-mono` and port colours `--nm-t-number`, `--nm-t-string`, `--nm-t-boolean`, `--nm-t-list`, `--nm-t-any`. Dark mode follows `prefers-color-scheme`, or set `data-theme="dark" | "light"` on the container.

## Security note

`math/expression` and `list/map` compile user text with `new Function`. They are meant for a person editing their own map. Remove them from the registry if maps come from untrusted sources.

## Development

```sh
npm install
npm test          # vitest: core, runtime and editor (happy-dom)
npm run build     # dist/ (ESM + .d.ts) and dist/nodemap.iife.js (window.Nodemap)
npm run demo      # docs/demo.html
```
