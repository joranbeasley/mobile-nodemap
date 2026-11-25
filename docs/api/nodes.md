# Nodes

`import { defineNode, extendNode } from 'mobile-nodemap'`

## `defineNode(spec): NodeType`

Defines a node type. Ports can be written as shorthand, and `run` is then typed from them:

```ts
const lerp = defineNode({
  type: 'acme/lerp',
  title: 'Lerp',
  inputs: { a: 'number', b: 'number', t: { type: 'number', default: 0.5 } },
  outputs: { out: 'number' },
  run: ({ a, b, t }) => ({ out: a + (b - a) * t }),   // a, b, t: number
});
```

Shorthand value types: `'number'` → `number`, `'string'` → `string`, `'boolean'` → `boolean`, `'list'` → `unknown[]`, and anything else → `any`. `multiple: true` makes the value an array.

## `extendNode(base, patch): NodeType`

Derives a node type. `inputs`, `outputs` and `params` are merged by name (the patch wins, and new ones are appended); `meta` is merged; everything else is overridden.

```ts
const router = extendNode(device, { type: 'net/router', title: 'Router', outputs: { lan: 'link' } });
```

## `NodeType`

| Field | Type | Purpose |
| --- | --- | --- |
| `type` | `string` | Required, unique, namespaced id. |
| `title`, `category`, `description`, `tags`, `docs` | | Add menu and search. |
| `color` | CSS colour | Header colour (themes may override, see `nodeColors`). |
| `caption(node)` | `→ string` | Header title for nodes without a name, from their params (e.g. `Shot 2 · Close-up`). Updates as params change. |
| `icon` | text, emoji or `<svg…>` | Header and add menu. |
| `width` | px | Fixed card width; it overrides the default 176–250 px limits. |
| `flavor` | `'source' \| 'transform' \| 'sink' \| 'view' \| 'control' \| string` | Role, for themes. Inferred when left out. |
| `width` | `number` | Fixed width in px. |
| `inputs`, `outputs` | `PortDef[]` | |
| `params` | `ParamDef[]` | |
| `ports(params)` | `→ { inputs?, outputs? }` | Ports that depend on params. |
| `run(inputs, ctx)` | `→ outputs \| Promise<outputs>` | `ctx`: `{ node, params, graphInputs, signal }`. Throw to report an error. |
| `pure` | `boolean` | `false` = never cache. |
| `view` | `{ render(el, result, node) }` | Custom preview inside the node. See `reactView` for React. |
| `emit(inputs, params)` | `→ Record<port, jsExpression>` | Inline this node in `emitSource` output. |
| `subgraph(node)` | `→ { graph, registry, title?, save? }` | The node is itself a node map. The editor shows an ↘ button on it that opens the map inside, running on the node's live inputs. With `save`, edits there change the node type (`graphNode()` does this; it refuses a map with errors or no Output). Without `save`, edits are dropped (library nodes). |
| `details(node, ctx)` | `→ NodeDetails` | What the editor shows when the node is tapped. `ctx` has the `graph` and the node's latest `result`. |
| `onCreate(node)` | `→ params \| void` | New nodes only (not on load). |
| `version`, `migrate(params, from)` | | Upgrade saved params. |
| `meta` | `Record<string, unknown>` | For engines and tools (the network engine reads `meta.role`). |

## `PortDef`

```ts
interface PortDef {
  name: string;
  type?: string;          // 'any' when left out
  label?: string;
  description?: string;
  default?: unknown;      // value when unconnected and no inline value is set
  inline?: boolean;       // show an inline editor when unconnected (default: primitive types)
  multiple?: boolean;     // inputs: accept many wires; the value is an array, ordered top to bottom
}
```

## `ParamDef`

Every param has `name`, `label?`, `description?` and `advanced?` (fold it behind "More"). The built-in kinds are:

| `kind` | Extra fields |
| --- | --- |
| `'number'` | `default`, `min`, `max`, `step`. With both `min` and `max` set, a slider is added. |
| `'text'` | `default`, `multiline`, `placeholder`, `code` (monospace) |
| `'boolean'` | `default` |
| `'select'` | `default`, `options: string[]` |
| any other string | A registered `ParamKind`; any extra fields are passed through |

An `images` param can take `prompt: (node, graph) => ({ prompt, aspect })`: what ✨ Generate suggests when an image generator is set (see [graph types](graph-types.md#image-generation--generate)).

Any param can take `when: (params) => boolean`, which shows it only when it applies to the node's other params. A hidden param keeps its value. The card and the Edit sheet update as those params change.

```ts
{ name: 'wornBy', kind: 'ref', of: 'drama2/character', when: (p) => p.kind === 'Outfit' }
```

## `ParamKind`: custom param editors

```ts
registry.defineParamKind({
  kind: 'color',
  render({ param, node, graph, value, set, key, choose }) {   // return an element; call set(v) on change; graph: the map; choose: a searchable picker sheet
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.key = key;                    // keeps focus across re-renders
    input.value = String(value);
    input.oninput = () => set(input.value);
    return input;
  },
  update(el, value) { (el as HTMLInputElement).value = String(value); },   // optional: undo / API changes
});
```

Drama boards add two kinds for references to other nodes (`refParam`, `refsParam`):

```ts
{ name: 'location', kind: 'ref', of: 'drama2/location' }                     // one id
{ name: 'shots', kind: 'refs', of: 'drama2/shot', exclusive: true }          // a list of ids
```

Each referenced node shows as a chip: tap it to jump to that node (`data-nm-open`) and tap × to remove it. A picker adds one: a plain select up to `searchAbove` choices (default 8), and beyond that a button that opens the editor's searchable chooser (`ctx.choose`). The chooser shows a hint under each name (who plays a character, a shot's episode and scene, a prop's type and wearer). With `exclusive`, a node can be referred to by only one node through that param, so the picker offers only free ones (a shot belongs to one scene). More options:

| Option | |
| --- | --- |
| `create` | The picker starts with "+ New …", which creates a node of type `of` and adds it. |
| `movable` | With `exclusive`: also offer nodes that other nodes hold, labelled "(in Scene 2)". Picking one moves it here. |
| `sortable` | ‹ › buttons on each chip (on the selected card) to reorder the list. |
| `renumber: 'number'` | Keep that param of the listed nodes in step with the order (1, 2, 3…; text or number, as it was) after any add, remove, move or reorder. A node moved away renumbers its old holder too. |
| `searchAbove` | Use the searchable chooser past this many choices (default 8). |

## `PortTypeDef`: custom value types

```ts
registry.definePortType({
  id: 'color', label: 'Colour', color: '#d6336c',
  accepts: ['string'],             // other types that may connect into it
  coerce: (v) => normalise(v),     // convert values arriving from accepted types
  inline: 'color',                 // inline editor: 'number' | 'text' | 'boolean' | a param kind | false
  default: '#888888',
  // How wires of this type look: dashed, with markers at the output end (start) or input end (end).
  // Markers: 'arrow' | 'triangle' | 'triangle-filled' | 'diamond' | 'diamond-filled' | 'circle'.
  wire: { dash: true, start: 'triangle' },
});
```

## `NodeDetails`

```ts
interface NodeDetails {
  title: string;
  subtitle?: string;
  code?: { lang: string; text: string };                         // shown with a Copy button
  actions?: { label: string; primary?: boolean; run(): void }[];
}
```

Custom nodes from the [library](library.md) return their JavaScript and an "Edit in graph" action.

## Helpers

- `normalizeNode(spec)` and `normalizePorts(spec)` turn shorthand into plain `NodeType` and `PortDef[]`.
- `flavorOf(def, inputs, outputs)`: see [themes](themes.md).
