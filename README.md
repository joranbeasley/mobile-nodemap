# mobile-nodemap

A small, dependency-free TypeScript library for building **node maps** (node graphs) that work well on phones, plus a runtime that **evaluates** them.

- **`mobile-nodemap/core`**: the data model and the extension API. `Graph`, `History`, plus `defineGraphType`, `definePack`, `defineNode`, `extendNode` and `Registry`. No DOM.
- **`mobile-nodemap/runtime`**: the evaluator. Memoised, async, cancellable execution; `compile()` turns a map into a plain async function; `graphNode()` turns a map into a reusable node. No DOM.
- **Built-in graph types and packs**: `mathGraph` / `mathPack` (about 35 nodes), `networkGraph` / `networkPack` (devices, data stores and a reachability engine), `umlGraph` / `umlPack` (class diagrams with UML arrows, checks and TypeScript export), `dramaGraph` / `dramaPack` (plan a production: characters, locations, props, shots, scenes and episodes, with pictures, shot lists and a Seedance video export), `drama2Graph` (Drama boards: the same model as tabs of linked cards, no wires) and `functionGraph` (build your own nodes).
- **Themes**: six built-in themes (three light, three dark) and node flavors. See [Themes and flavors](#themes-and-flavors).
- **Ports and adapters**: standard interfaces (`GraphPort`, `NodeDefinition`, `EnginePort`, `StoragePort`, `RenderPort`, `NodeRunner`, …) with swappable adapters. See [Architecture](#architecture).

**API reference: [docs/api](docs/api)**. Design records are in [docs/adr](docs/adr) and product requirements in [docs/prd](docs/prd).
- **`mobile-nodemap/editor`**: `NodeEditor`, a touch-first DOM/SVG editor with pinch zoom, drag or tap-to-connect wiring, a long-press add menu, live results and undo. Graph types can turn it into tabs of cards (views: grid, rows or your own layout) with links between cards. It opens nodes that are made of maps, has a searchable picker, and runs plugins from packs and graph types (`EditorPlugin`).
- **`mobile-nodemap/layout`**: auto-layout, wire routing and placement. A roomy layered layout that flows left to right or top to bottom, an orthogonal router that steers wires around nodes, free-space placement, and an optional [ELK](https://eclipse.dev/elk/) adapter. No DOM.
- **`mobile-nodemap/react`**: `<NodeMap>`, hooks (`useGraph`, `useEvaluator`, `useEvaluation`, `useGraphValue`) and `reactView()` for React-rendered node previews.
- **`mobile-nodemap/element`**: the `<node-map>` custom element. Importing it registers the tag.

The demo playground is in `docs/demo.html` (one self-contained file).

## Quick start

```ts
import { Graph, Evaluator, NodeEditor, mathGraph } from 'mobile-nodemap';

const registry = mathGraph.createRegistry();      // what this kind of map can contain
const graph = new Graph(registry);
const evaluator = new Evaluator(graph, registry);
new NodeEditor(document.getElementById('canvas')!, { graph, registry, evaluator });
```

Give the container a size (for example `height: 100dvh`). The editor injects its own stylesheet.

## Extending it

Everything a map can contain comes from plug-ins, and the built-in maths and network maps use the same API a third party would. There are three layers:

| Layer | What it is | Who writes it |
| --- | --- | --- |
| **Node type** | one kind of box: ports, params, a `run` function, a preview | anyone |
| **Pack** | what a library publishes: node types, plus the port types, param editors and CSS they need | library authors |
| **Graph type** | a kind of map: which packs and nodes it offers, its connection rules, and how it runs | apps, or anyone building on others |

### Graph types

```ts
import { defineGraphType, registerGraphType, mathGraph, networkGraph } from 'mobile-nodemap';

export const lab = defineGraphType({
  id: 'acme/lab',                    // saved in JSON as "type"; namespace your ids
  title: 'Lab',
  extends: [mathGraph],              // or ids of registered types: ['math']
  packs: [unitsPack, statsPack],
  nodes: [myOneOffNode],
  exclude: ['async/*', 'text/case'], // drop inherited nodes
  rules: {
    allowCycles: false,
    canConnect: (from, to, graph) => (to.nodeType === 'acme/sink' && from.def.type !== 'number' ? 'Sinks take numbers' : null),
  },
  engine: undefined,                 // keep dataflow, or bring your own (below)
  editor: { wires: 'smart', autoLayout: true },
  examples: [{ id: 'hello', name: 'Hello', graph: helloJson }],
});
registerGraphType(lab);              // lets <node-map graph-type="acme/lab"> and saved JSON find it

const registry = lab.createRegistry();
const sibling = lab.extend({ id: 'acme/lab-lite', title: 'Lab lite', exclude: ['stats/*'] });
```

Built in:

- **`mathGraph`** (`'math'`): dataflow over numbers, lists, logic, text and async nodes, plus graph inputs and outputs. Maps can be called as functions.
- **`networkGraph`** (`'network'`): devices and cables with loops allowed. Instead of dataflow, its engine works out each device's fastest path to the internet: latency, hops, bottleneck bandwidth, and whether a second path exists. Powered-off devices and closed firewalls cut traffic, and a rule stops laptops plugging straight into the internet.
- **`umlGraph`** (`'uml'`): class diagrams: classes, interfaces, enums and notes joined by inheritance, implementation, association, composition, aggregation and dependency, each drawn with its UML arrow. It flows top to bottom, checks that classes implement their interfaces, and exports TypeScript.
- **`dramaGraph`** (`'drama'`): productions for a drama club or film: characters (with an appearance kept word for word in prompts), per-scene costumes, locations and props feed shots (one location, many characters each), numbered shots make scenes, scenes make episodes and seasons. Nodes hold pictures, and the engine works out appearances, sluglines, running times and shot lists. Every shot exports as a **Seedance** generation (a zip with `shot.md` and its reference images numbered in upload order). Scenes, episodes and seasons export a root script with one zip per shot and their storyboards.

`registryFor(json)` builds the right registry for a saved map from its `type`.

### Packs

```ts
import { definePack } from 'mobile-nodemap';

export const palettePack = definePack({
  id: 'acme/palette',
  version: '1.0.0',
  portTypes: [{
    id: 'color', label: 'Colour', color: '#d6336c',    // wire and port colour
    accepts: ['string'], coerce: (v) => normalise(v),  // text can flow in, cleaned up on the way
    inline: 'color',                                   // editor for unconnected inputs
    default: '#888888',
  }],
  paramKinds: [{                                       // a custom editor, usable by any param or port type
    kind: 'color',
    render: ({ value, set, key }) => { /* return an element; call set(v) on change */ },
    update: (el, value) => { /* optional: reflect undo / API changes */ },
  }],
  conversions: [['number', 'string']],
  nodes: [mixNode, scaleNode, contrastNode],
  css: `.pal-row { display: flex }`,                   // injected once per document or shadow root
  setup(registry) { /* anything else */ },
});

registry.use(palettePack);   // or list it in a graph type's packs
```

The demo's **Palette** graph type is a complete third-party pack of about 200 lines (`demo/palette.ts`). It is written only against the public API.

### Node types

```ts
import { defineNode, extendNode } from 'mobile-nodemap';

export const lerp = defineNode({
  type: 'acme/lerp',                 // namespace/name
  title: 'Lerp', category: 'Math', color: '#3b5bdb',
  icon: 'λ',                         // text, emoji or an inline <svg>
  description: 'Shown in the add menu', tags: ['mix', 'interpolate'], docs: 'https://…',
  inputs: {                          // shorthand: name → type, or name → PortDef
    a: 'number',
    b: 'number',
    t: { type: 'number', default: 0.5, description: '0 → a, 1 → b' },
  },
  outputs: { out: 'number' },
  params: [
    { name: 'clamp', kind: 'boolean', default: true },
    { name: 'curve', kind: 'select', options: ['linear', 'smooth'], default: 'linear', advanced: true },  // behind "More"
  ],
  run: ({ a, b, t }, { params, signal }) => ({ out: a + (b - a) * t }),   // a, b, t are typed as numbers
});

const smoothLerp = extendNode(lerp, { type: 'acme/smooth-lerp', title: 'Smooth lerp', params: [{ name: 'curve', kind: 'select', options: ['smooth'], default: 'smooth' }] });
```

Everything a node type can say about itself:

| Field | Purpose |
| --- | --- |
| `inputs`, `outputs` | Ports, as a list of PortDefs or `{ name: type }` shorthand. `multiple: true` on an input collects every wire into an array, ordered top to bottom. |
| `params` | Built-in kinds `number`, `text` (`code: true` for monospace), `boolean` and `select`, or any registered param kind. `advanced: true` tucks a param behind **More**. |
| `run(inputs, ctx)` | Sync or async. `ctx` holds `params`, `signal` (aborts when superseded), `graphInputs` and `node`. Throw to show an error. |
| `ports(params)` | Ports that depend on params, like the expression node's variables. |
| `view.render(el, result, node)` | A custom preview: chart, swatch or badge. `reactView(Component)` renders it with React. |
| `pure: false` | Never cache, for random values or clocks. |
| `onCreate(node)` | Set up a newly added node; return params to merge in. |
| `version`, `migrate(params, from)` | Saved maps upgrade themselves when a node type's params change shape. |
| `icon`, `color`, `width`, `tags`, `docs`, `meta` | Presentation, search terms, and free-form data for engines (the network engine reads `meta.role`). |

### Engines

A graph type can replace dataflow evaluation with anything: a simulation, a solver, a network analysis, or a call to a server.

```ts
const engine: GraphEngine = {
  name: 'Reachability',
  callable: false,               // hides "call as a function" in tools
  async run({ graph, registry, inputs, signal, publish }) {
    for (const node of graph.nodes.values()) publish(node.id, { status: 'ok', outputs: { status: '…' } });
    return { outputs: { summary: 42 } };   // ends up in EvalReport.outputs
  },
};
```

The editor, `live()` re-runs, the React hooks and `<node-map>` events all work with custom engines.

### Ideas for packs

Unit conversion, statistics, HTTP and JSON (async nodes), audio graphs (Web Audio), shader graphs (port types for vectors and textures), state machines (`allowCycles` plus an engine), CI pipelines, home automation, and electrical circuits (an engine that solves the network).

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

A map with `graph/input` and `graph/output` nodes compiles to **one plain async function**. It composes the nodes' `run` functions directly, with no evaluator or editor involved:

```ts
import { compile, compileFunction, signature, emitSource, registryRunner } from 'mobile-nodemap';

const cylinder = compile(graph, registry, 'cylinder');   // (inputs?, { signal? }) => Promise<outputs>
await cylinder({ radius: 2, height: 5 });                 // { volume: 62.83… }
signature(graph);                                         // { inputs: [...], outputs: [...] }

const volume = compileFunction(graph, registry);          // single-output maps: returns the value itself
await volume({ radius: 2, height: 5 });                   // 62.83…

// The same map as the source of one standalone TypeScript (or JS) function:
emitSource(graph, registry, { name: 'cylinderVolume', single: true });
```

`emitSource` inlines every node that has an `emit` hook (most math nodes do). Other nodes are called through a `runner` argument (the `NodeRunner` port, e.g. `registryRunner(registry)`), so generated code depends on nothing but that interface. Errors throw `NodeRunError` with the failing node's id.

## Function builder and library

`functionGraph` is a canvas for building custom nodes:

- **Input** leaves are the node's arguments, top to bottom.
- Exactly **one Output** is its result. A second one is hidden from the add menu and refused by the API.
- `graph.validate()` lists what's wrong, live: no output, an unconnected output, bad or duplicate input names, nodes that don't affect the output.

```ts
import { functionGraph, compileNode, NodeLibrary, localStorageStore, mathGraph } from 'mobile-nodemap';

// A name is required; the description is optional. The type id defaults to lib/<name-as-slug>.
const node = compileNode(graph, functionGraph.createRegistry(), { name: 'Cylinder volume', description: 'πr²h' });

const library = new NodeLibrary();
library.add({ name: 'Cylinder volume', description: 'πr²h' }, graph, registry);   // compiles first; refuses broken maps
library.on('edit', (entry) => openInBuilder(entry.graph));                          // "Edit in graph" was chosen
const math = mathGraph.extend({ id: 'my-math', title: 'Math', packs: [library.toPack()] });

const store = localStorageStore('app:');                  // any StoragePort adapter
library.on('change', (entries) => store.put('library', entries));
library.source('lib/cylinder-volume', registry);           // one TypeScript function
```

## Layout, routing and placement

The editor arranges things so you rarely have to drag on a small screen:

- **One flow, never crammed.** Maps flow **left to right**, or **top to bottom** on narrow portrait screens (`direction: 'auto'`, the default; or force `'LR'` / `'TB'`). Top to bottom, inputs sit on the top edge of each node and outputs on the bottom, so wires run downwards. Layouts are never wrapped into rows. Gaps are generous, and the view opens at a readable zoom; pan to see the rest, or tap **Show whole map** for the overview.
- **Tidy** (toolbar button, <kbd>L</kbd>, or `editor.autoLayout()`) runs the layout engine in the current flow and animates nodes into place. A map arranged for the other flow (made on a desktop, opened on a phone) is tidied automatically when it opens. The flow is remembered in `graph.meta.flow`.
- **Routed wires** (`wires: 'smart'`, the default) are orthogonal and go around nodes. The router runs A* over a sparse grid built from node edges and the channels between them. Bends cost extra, and wires from different outputs avoid sharing a segment. While you drag a node, only its own wires re-route; everything re-routes when you drop it. Use `wires: 'curved'` for classic S-curves.
- **Add next to the selection**: with a node selected, **+** opens the add sheet ready to wire the new node to it. It picks the side the node needs: after it if its output is unused, before it if it still has an open input, and before it for nodes with no outputs. A switch (`→ Node` / `Node →` / Unconnected) and port chips let you change that. The new node is selected afterwards, so pressing **+** again keeps extending the chain. `editor.openAddSheet()` and `editor.suggestConnection(id)` expose this.
- **Tapped ports and wires**: tap an output port and press **+** to add a node after that output (an input port adds one before it). Tap a wire and press **+** to insert a node into it (`editor.spliceNode(type, edgeId)`). The menu only lists nodes that fit both ends.
- **Making room**: a new node never just lands wherever there is space. If it joins nodes already wired to the same port, it goes into their layer and the rest of that layer shifts along. If it lands on anything further along the flow, a new layer opens and the downstream nodes move along the flow (right, or down top to bottom). Neighbours animate into place.
- **Placement**: a node added by dropping a wire lands one layer over (right, or below top to bottom) with its port lined up. A node dropped on top of another slides off it. When a node grows (a chart, status or error appears), the nodes after it move just enough to keep a full gap.

```ts
import { layered, elkLayout, Router, findFreeSpot } from 'mobile-nodemap/layout';
import ELK from 'elkjs/lib/elk.bundled.js';           // optional peer dependency

editor.setLayout(elkLayout(new ELK()));               // or layered({ layerGap: 120, nodeGap: 56 })
editor.setDirection('TB');                            // 'auto' | 'LR' | 'TB'

// The pieces work without the editor too:
const positions = layered()({ nodes, edges, direction: 'TB' });
const points = new Router(nodeRects).route(outputPoint, inputPoint, owner, 'TB');
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

`<NodeMap>` props: `graphType` or `registry` (`useRegistry(graphType)` memoises one), `graph` or `defaultValue`, `evaluator` (or `false`), `wires`, `layout`, `toolbar`, `placement`, `theme`, `autoLayout`, `onChange`, `onSelect`, `onEvaluate`. Its ref is the `NodeEditor`. `useGraphValue(graph)` gives you the JSON and re-renders on every change. React 18 and 19 are supported, as optional peer dependencies.

## Custom element

```html
<script type="module">import 'mobile-nodemap/element';</script>

<node-map wires="smart" auto-layout style="height: 420px">
  <script type="application/json">{ "version": 1, "nodes": [...], "edges": [...] }</script>
</node-map>
```

- **Attributes**: `graph-type` (a registered graph type id; defaults to the inline JSON's `type`, else `math`), `wires` (`smart` | `curved`), `theme` (`light` | `dark`), `auto-layout`, `no-toolbar`, `no-eval`.
- **Properties**: `graphType`, `registry` (defaults to the graph type's), `value` (graph JSON), `layout`, plus `graph`, `editor` and `evaluator`.
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
| Go to a connected node off screen | tap its ghost chip on the screen edge | click the ghost |
| Edit a node's fields | tap the node to select it, then tap the field | same |
| Zoom in on a node | tap it while zoomed out: fields and ports ignore taps until you're zoomed in | click it while zoomed out |
| Edit a node (name, all settings) | double-tap it, or select it and tap the pencil | double-click, or select and press <kbd>E</kbd> |
| Add node | long-press the background, or **+** | **+**, <kbd>A</kbd> or <kbd>Space</kbd> |
| Add a connected node | select a node, then **+** | select, then **+**, <kbd>A</kbd> or <kbd>Space</kbd> |
| Add on a specific port | tap the port, then **+** | click the port, then **+** |
| Insert into a wire | tap the wire, then **+** | click the wire, then **+** |
| Tidy layout | toolbar | <kbd>L</kbd> |
| Delete | select, then the bin | <kbd>Delete</kbd> |
| Undo / redo | toolbar | <kbd>Ctrl/⌘ Z</kbd>, <kbd>Ctrl/⌘ Shift Z</kbd> |

Ports have a 44px touch target, form fields use 16px text (no iOS focus zoom), and the add menu is a bottom sheet on phones.

**Tap a custom node** in any editor to see its details card: its name and description, its JavaScript (one function, with Copy) and **Edit in graph**, which opens its source map in the function builder. Saving there with the same type updates the node everywhere. Any node type can provide a card through `details(node)`.

## Themes and flavors

```ts
new NodeEditor(el, { graph, registry, theme: 'midnight' });
editor.setTheme({ light: 'paper', dark: 'graphite' });   // follows the system setting
editor.setTheme(null);                                    // back to the page's own colours
```

Built in: **Daylight**, **Paper**, **Mint** (light) and **Midnight**, **Graphite**, **Synthwave** (dark). A theme is plain data:

```ts
import { defineTheme, registerTheme, daylight } from 'mobile-nodemap';

registerTheme(defineTheme({
  ...daylight, id: 'acme', name: 'Acme',
  header: 'solid',                 // 'tint' | 'solid' | 'line'
  radius: 6,
  colors: { ...daylight.colors, accent: '#e8590c' },
  flavors: { ...daylight.flavors, source: '#2f9e44' },
  nodeColors: false,               // colour nodes by flavor, not by node type
}));
```

Every node has a **flavor** that themes colour and the editor shapes: `source` (a rounded leading edge), `transform`, `sink` (a rounded trailing edge), `view` (a halo) and `control` (dashed). It is inferred from the ports, or set with `flavor` on the node type. Packs may add their own flavor names and colour them in a theme.

Without a theme, every colour is a CSS variable you can set on `.nm-root`, any ancestor, or `<node-map>`: `--nm-bg`, `--nm-dot`, `--nm-node`, `--nm-node-2`, `--nm-border`, `--nm-text`, `--nm-muted`, `--nm-accent`, `--nm-wire`, `--nm-danger`, `--nm-font`, `--nm-mono`, `--nm-radius`, flavor colours `--nm-f-source` and so on, and port colours `--nm-t-number`, `--nm-t-string`, `--nm-t-boolean`, `--nm-t-list` and `--nm-t-any`. Dark mode follows `prefers-color-scheme`, or set `data-theme="dark" | "light"` on the container.

## Architecture

Ports and adapters ([ADR 0002](docs/adr/0002-ports-and-adapters.md)). The core (graph model, registry, compiler) has no DOM and no dependencies, and talks to the world through standard interfaces in `src/ports`:

| Port | Role | Adapters shipped |
| --- | --- | --- |
| `GraphPort` | the standard graph interface | `Graph` |
| `NodeDefinition` | the standard node interface | every node type |
| `CompilerPort` | map → function or source | `defaultCompiler` (`compile`, `emitSource`) |
| `RenderPort` | a UI that edits a session | `domEditor` (`NodeEditor`), `<NodeMap>`, `<node-map>` |
| `EnginePort` | how a map runs | `dataflowEngine`, `networkEngine`, the memoised `Evaluator` |
| `StoragePort` | where maps and libraries live | `memoryStore()`, `localStorageStore()` |
| `LayoutEnginePort` | arranging nodes | `layered()`, `elkLayout()` |
| `RouterPort` | wire paths around nodes | `Router` |
| `NodeRunner` | how generated code calls nodes | `registryRunner()` |

## Security note

`math/expression` and `list/map` compile user text with `new Function`. They are meant for a person editing their own map. Remove them from the registry if maps come from untrusted sources.

## Development

```sh
npm install
npm test          # vitest: core, runtime, layout, editor, React and element (happy-dom)
npm run build     # dist/ (ESM + .d.ts) and dist/nodemap.iife.js (window.Nodemap)
npm run demo      # docs/demo.html
```
