# Custom element

`import 'mobile-nodemap/element'` registers `<node-map>`. With the browser bundle, call `Nodemap.defineNodeMapElement()`. `defineNodeMapElement(tag = 'node-map')` is safe to call more than once.

```html
<node-map graph-type="network" theme="midnight" auto-layout style="height: 420px">
  <script type="application/json">{ "version": 1, "type": "network", "nodes": [...], "edges": [...] }</script>
</node-map>
```

The editor renders in a shadow root. `--nm-*` variables set on the element or its ancestors still theme it, and the canvas is exposed as `::part(canvas)`.

## Attributes

| Attribute | |
| --- | --- |
| `graph-type` | A registered graph type id. Defaults to the inline JSON's `type`, else `math`. |
| `theme` | `light` or `dark` (the default palette), or a theme id. |
| `wires` | `smart` or `curved`. |
| `direction` | `auto` (default), `LR` or `TB`. |
| `readonly` | View only (see the editor's `readOnly`). Adding or removing the attribute switches it. |
| `auto-layout` | Tidy on load (also on when the graph type asks for it). |
| `no-toolbar` | Hide the toolbar. |
| `no-eval` | Edit only; don't run nodes. |

## Properties

| Property | |
| --- | --- |
| `graphType` | A `GraphType` object; no registration needed. Its editor defaults (direction, views as tabs, plugins) apply. |
| `registry` | Defaults to the graph type's registry. |
| `layout` | A layout engine. |
| `value` | Get or set the map's JSON. |
| `graph`, `editor`, `evaluator` | Read-only. |

Properties set before the element is defined are picked up when it upgrades.

## Methods

| Method | |
| --- | --- |
| `autoLayout(opts?)` | Tidy the map. |
| `fit()` | Show everything. |
| `run(inputs?)` | Run in place: results show on the nodes. Returns the report. |
| `call(inputs?)` | Run as a function: `compile(value, registry)(inputs)`. |

## Events

All events bubble and are composed.

| Event | `detail` |
| --- | --- |
| `change` | `{ value: GraphJSON, change }` |
| `select` | `{ node?, edge? }` |
| `evaluate` | the `EvalReport` |
