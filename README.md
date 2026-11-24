# mobile-nodemap

A small, dependency-free TypeScript library for building **node maps** (node graphs) that work well on phones, plus a runtime that **evaluates** them.

- **`mobile-nodemap/core`**: the data model. `Graph` (nodes, ports, edges, JSON), `Registry` (node type definitions), `History` (undo/redo). No DOM.
- **`mobile-nodemap/runtime`**: the evaluator. Memoised, async, cancellable execution; `compile()` turns a map into a plain async function; `graphNode()` turns a map into a reusable node; `stdlib` has about 30 ready-made nodes. No DOM.
- **`mobile-nodemap/editor`**: `NodeEditor`, a touch-first DOM/SVG editor with pinch zoom, drag or tap-to-connect wiring, a long-press add menu, live results and undo.
- **`mobile-nodemap/layout`**: auto-layout, wire routing and placement. A layered layout that wraps to fit portrait screens, an orthogonal router that steers wires around nodes, free-space placement, and an optional [ELK](https://eclipse.dev/elk/) adapter. No DOM.
- **`mobile-nodemap/react`**: `<NodeMap>`, hooks (`useGraph`, `useEvaluator`, `useEvaluation`, `useGraphValue`) and `reactView()` for React-rendered node previews.
- **`mobile-nodemap/element`**: the `<node-map>` custom element. Importing it registers the tag.

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

## Layout, routing and placement

The editor arranges things so you rarely have to drag on a small screen:

- **Tidy** (toolbar button, <kbd>L</kbd>, or `editor.autoLayout()`) runs the layout engine and animates nodes into place. On a narrow portrait canvas the layout wraps into rows that fit the width at a readable zoom.
- **Routed wires** (`wires: 'smart'`, the default) are orthogonal and go around nodes. The router runs A* over a sparse grid built from node edges and the channels between them. Bends cost extra, and wires from different outputs avoid sharing a segment. While you drag a node, only its own wires re-route; everything re-routes when you drop it. Use `wires: 'curved'` for classic S-curves.
- **Add next to the selection**: with a node selected, **+** opens the add sheet ready to wire the new node to it. It picks the side the node needs: after it if its output is unused, before it if it still has an open input, and before it for nodes with no outputs. A switch (`→ Node` / `Node →` / Unconnected) and port chips let you change that. The new node is selected afterwards, so pressing **+** again keeps extending the chain. `editor.openAddSheet()` and `editor.suggestConnection(id)` expose this.
- **Tapped ports and wires**: tap an output port and press **+** to add a node after that output (an input port adds one before it). Tap a wire and press **+** to insert a node into it (`editor.spliceNode(type, edgeId)`). The menu only lists nodes that fit both ends.
- **Making room**: a new node never just lands wherever there is space. If it joins nodes already wired to the same port, it goes into their column and the nodes below shift down. If it lands on anything further along the flow, a column opens up and the downstream nodes slide right (or the upstream nodes slide left). Neighbours animate into place.
- **Placement**: a node added by dropping a wire lands one column over with its port lined up, in the nearest free space. A node dropped on top of another slides off it. When a node grows (a chart or an error appears), the nodes below it are pushed down.

```ts
import { layered, elkLayout, Router, findFreeSpot } from 'mobile-nodemap/layout';
import ELK from 'elkjs/lib/elk.bundled.js';           // optional peer dependency

editor.setLayout(elkLayout(new ELK()));               // or layered({ gapX: 80, gapY: 36 })
await editor.autoLayout({ maxWidth: 600 });           // force row wrapping

// The pieces work without the editor too:
const positions = layered()({ nodes, edges, maxWidth: 600 });
const points = new Router(nodeRects).route(outputPoint, inputPoint);
```

A layout engine is any function `(input) => positions` (sync or async), so you can plug in dagre, d3-dag and so on.

## React

```tsx
import { NodeMap, useGraph, useEvaluator, useEvaluation, reactView } from 'mobile-nodemap/react';

function Weather() {
  const graph = useGraph(registry, weatherMap);
  const evaluator = useEvaluator(graph, registry);
  const [f, setF] = useState(70);
  const { outputs, running } = useEvaluation(evaluator, { f });   // feeds graph inputs, re-runs on change

  return (
    <>
      <input type="range" value={f} onChange={(e) => setF(+e.target.value)} />
      <p>{outputs.advice}</p>
      <NodeMap registry={registry} graph={graph} evaluator={evaluator} autoLayout style={{ height: 480 }} />
    </>
  );
}

// A node whose preview is a React component:
registry.define({ type: 'view/gauge', inputs: [...], run: ..., view: reactView(({ result, node }) => <Gauge value={result?.outputs?.value} />) });
```

`<NodeMap>` props: `registry`, `graph` or `defaultValue`, `evaluator` (or `false`), `wires`, `layout`, `toolbar`, `placement`, `theme`, `autoLayout`, `onChange`, `onSelect`, `onEvaluate`. Its ref is the `NodeEditor`. `useGraphValue(graph)` gives you the JSON and re-renders on every change. React 18 and 19 are supported, as optional peer dependencies.

## Custom element

```html
<script type="module">import 'mobile-nodemap/element';</script>

<node-map wires="smart" auto-layout style="height: 420px">
  <script type="application/json">{ "version": 1, "nodes": [...], "edges": [...] }</script>
</node-map>
```

- **Attributes**: `wires` (`smart` | `curved`), `theme` (`light` | `dark`), `auto-layout`, `no-toolbar`, `no-eval`.
- **Properties**: `registry` (defaults to `stdlib`), `value` (graph JSON), `layout`, plus `graph`, `editor` and `evaluator`.
- **Methods**: `autoLayout()`, `fit()`, `run(inputs)` (results show on the nodes), `call(inputs)` (runs the map as a function).
- **Events**: `change` (`{ value, change }`), `select`, `evaluate` (the run report).

It renders in a shadow root. `--nm-*` CSS variables set on the element or any ancestor still theme it. With the IIFE bundle, call `Nodemap.defineNodeMapElement()`.

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
| Add a connected node | select a node, then **+** | select, then **+**, <kbd>A</kbd> or <kbd>Space</kbd> |
| Add on a specific port | tap the port, then **+** | click the port, then **+** |
| Insert into a wire | tap the wire, then **+** | click the wire, then **+** |
| Tidy layout | toolbar | <kbd>L</kbd> |
| Delete | select, then the bin | <kbd>Delete</kbd> |
| Undo / redo | toolbar | <kbd>Ctrl/⌘ Z</kbd>, <kbd>Ctrl/⌘ Shift Z</kbd> |

Ports have a 44px touch target, form fields use 16px text (no iOS focus zoom), and the add menu is a bottom sheet on phones.

## Theming

Every colour is a CSS variable you can set on `.nm-root`, any ancestor, or `<node-map>`: `--nm-bg`, `--nm-dot`, `--nm-node`, `--nm-node-2`, `--nm-border`, `--nm-text`, `--nm-muted`, `--nm-accent`, `--nm-wire`, `--nm-danger`, `--nm-font`, `--nm-mono` and port colours `--nm-t-number`, `--nm-t-string`, `--nm-t-boolean`, `--nm-t-list`, `--nm-t-any`. Dark mode follows `prefers-color-scheme`, or set `data-theme="dark" | "light"` on the container.

## Security note

`math/expression` and `list/map` compile user text with `new Function`. They are meant for a person editing their own map. Remove them from the registry if maps come from untrusted sources.

## Development

```sh
npm install
npm test          # vitest: core, runtime, layout, editor, React and element (happy-dom)
npm run build     # dist/ (ESM + .d.ts) and dist/nodemap.iife.js (window.Nodemap)
npm run demo      # docs/demo.html
```
